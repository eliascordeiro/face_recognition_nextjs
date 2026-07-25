'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClientAuth } from '../layout'

interface ObraOption {
  id: number
  name: string
}

interface Expense {
  id: number
  title: string
  category: string
  vendor_name: string | null
  amount_cents: number
  expense_date: string
  notes: string | null
  receipt_number: string | null
  receipt_total_cents: number | null
  receipt_ocr_text: string | null
  ocr_status: string
  created_at: string
  obra_id: number | null
  obra_name: string | null
  receipt_image_url: string | null
  receipt_image_public_id: string | null
  receipt_image_format: string | null
  receipt_image_bytes: number | null
  receipt_image_width: number | null
  receipt_image_height: number | null
  receipt_uploaded_at: string | null
}

interface UploadedReceiptMeta {
  url: string
  publicId: string
  format: string | null
  bytes: number | null
  width: number | null
  height: number | null
}

const CATEGORY_OPTIONS = [
  { value: 'material', label: 'Material' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'equipamento', label: 'Equipamento' },
  { value: 'servico', label: 'Serviço' },
  { value: 'outros', label: 'Outros' },
]

function formatMoney(cents: number | null | undefined) {
  const value = (cents ?? 0) / 100
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function inputToApiMoney(value: string) {
  return value.replace(/\./g, '').replace(',', '.')
}

function centsToInputMoney(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function parseMoneyToCents(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const cleaned = trimmed.replace(/\s+/g, '').replace(/[^\d,.-]/g, '')
  if (!cleaned) return null

  let normalized = cleaned
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

function normalizeOcrLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractReceiptInsights(rawText: string) {
  const text = rawText.replace(/\r/g, '')
  const lines = normalizeOcrLines(text)
  const amountCandidates: Array<{ cents: number; score: number; line: string }> = []
  const amountPattern = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+\.\d{2}/g

  for (const line of lines) {
    const matches = line.match(amountPattern) ?? []
    for (const match of matches) {
      const cents = parseMoneyToCents(match)
      if (cents === null || cents <= 0) continue

      let score = 0
      if (/total|valor total|total a pagar|vl total|liquido|valor pago/i.test(line)) score += 6
      if (/subtotal/i.test(line)) score += 3
      if (/troco|desconto|taxa|juros/i.test(line)) score -= 4
      score += Math.min(cents / 100000, 3)

      amountCandidates.push({ cents, score, line })
    }
  }

  amountCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.cents - a.cents
  })

  const selectedAmount = amountCandidates[0]?.cents ?? null
  const dateMatch = text.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{2,4})\b/)
  const receiptNumberMatch = text.match(/(?:NFC-?e|NF-?e|CUPOM|DOC(?:UMENTO)?|COO|CCF|N[ÚU]MERO)\D{0,12}(\d{3,})/i)

  const vendorName = lines.slice(0, 6).find((line) => {
    if (line.length < 5 || line.length > 60) return false
    if (/cnpj|cpf|inscri|nota|fiscal|cupom|documento|emit|cliente|consumidor|valor|total|qtd|item|serie/i.test(line)) return false
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(line)) return false
    const digits = (line.match(/\d/g) ?? []).length
    return digits <= Math.max(2, Math.floor(line.length * 0.2))
  }) ?? null

  let expenseDate: string | null = null
  if (dateMatch) {
    const [, day, month, yearRaw] = dateMatch
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    expenseDate = `${year}-${month}-${day}`
  }

  return {
    selectedAmountCents: selectedAmount,
    selectedAmountLabel: selectedAmount !== null ? centsToInputMoney(selectedAmount) : '',
    vendorName,
    receiptNumber: receiptNumberMatch?.[1] ?? null,
    expenseDate,
    suggestedTitle: vendorName ? `Compra - ${vendorName}` : null,
    bestAmountLine: amountCandidates[0]?.line ?? null,
  }
}

export default function ExpensesPage() {
  const auth = useClientAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [obras, setObras] = useState<ObraOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ocrMessage, setOcrMessage] = useState<string | null>(null)
  const [receiptImage, setReceiptImage] = useState<File | null>(null)
  const [receiptImagePreview, setReceiptImagePreview] = useState<string | null>(null)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [uploadedReceipt, setUploadedReceipt] = useState<UploadedReceiptMeta | null>(null)
  const [ocrSuggestedTotalCents, setOcrSuggestedTotalCents] = useState<number | null>(null)
  const [form, setForm] = useState({
    title: '',
    category: 'material',
    amount: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    obraId: '',
    vendorName: '',
    receiptNumber: '',
    notes: '',
    receiptOcrText: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/expenses').then(async (res) => (res.ok ? res.json() : [])),
      fetch('/api/obras').then(async (res) => (res.ok ? res.json() : [])),
    ]).then(([expenseData, obraData]) => {
      setExpenses(Array.isArray(expenseData) ? expenseData : [])
      setObras(Array.isArray(obraData) ? obraData.map((obra) => ({ id: obra.id, name: obra.name })) : [])
      setLoading(false)
    })
  }, [])

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount_cents, 0),
    [expenses]
  )

  const withReceiptText = useMemo(
    () => expenses.filter((expense) => expense.receipt_ocr_text && expense.receipt_ocr_text.trim().length > 0).length,
    [expenses]
  )

  function handleReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setReceiptImage(file)
    setOcrMessage(null)
    setOcrSuggestedTotalCents(null)
    setUploadedReceipt(null)

    if (!file) {
      setReceiptImagePreview(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setReceiptImagePreview(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
  }


  async function uploadReceiptIfNeeded() {
    if (!receiptImage) return uploadedReceipt
    if (uploadedReceipt) return uploadedReceipt

    setUploadingReceipt(true)
    try {
      const body = new FormData()
      body.append('file', receiptImage)

      const res = await fetch('/api/expenses/upload', {
        method: 'POST',
        body,
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Falha ao enviar comprovante')
      }

      const nextMeta: UploadedReceiptMeta = {
        url: data.url,
        publicId: data.publicId,
        format: data.format ?? null,
        bytes: typeof data.bytes === 'number' ? data.bytes : null,
        width: typeof data.width === 'number' ? data.width : null,
        height: typeof data.height === 'number' ? data.height : null,
      }
      setUploadedReceipt(nextMeta)
      return nextMeta
    } finally {
      setUploadingReceipt(false)
    }
  }

  async function runReceiptOcr() {
    if (!receiptImage) {
      setError('Selecione uma foto do comprovante antes de executar o OCR')
      return
    }

    setError(null)
    setOcrMessage('Preparando leitura do comprovante...')
    setOcrRunning(true)
    setOcrProgress(0)

    try {
      const { recognize } = await import('tesseract.js')
      const result = await recognize(receiptImage, 'por+eng', {
        logger: (message) => {
          if (typeof message.progress === 'number') {
            setOcrProgress(Math.max(0, Math.min(100, Math.round(message.progress * 100))))
          }
          if (message.status) {
            setOcrMessage(message.status)
          }
        },
      })

      const recognizedText = result.data.text.trim()
      if (!recognizedText) {
        setOcrMessage('A leitura terminou, mas nenhum texto útil foi encontrado.')
        setOcrSuggestedTotalCents(null)
        return
      }

      const insights = extractReceiptInsights(recognizedText)
      setOcrSuggestedTotalCents(insights.selectedAmountCents)
      setForm((prev) => ({
        ...prev,
        title: prev.title || insights.suggestedTitle || 'Despesa via comprovante',
        amount: prev.amount || insights.selectedAmountLabel,
        vendorName: prev.vendorName || insights.vendorName || '',
        receiptNumber: prev.receiptNumber || insights.receiptNumber || '',
        expenseDate: insights.expenseDate || prev.expenseDate,
        receiptOcrText: recognizedText,
      }))

      if (insights.selectedAmountCents !== null) {
        setOcrMessage(`Leitura concluída. Total sugerido: ${formatMoney(insights.selectedAmountCents)}.`)
      } else {
        setOcrMessage('Leitura concluída. Revise o texto OCR e informe o valor manualmente.')
      }
    } catch {
      setError('Falha ao processar o OCR do comprovante')
      setOcrMessage(null)
    } finally {
      setOcrRunning(false)
    }
  }

  async function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    let receiptMeta: UploadedReceiptMeta | null = uploadedReceipt
    try {
      receiptMeta = await uploadReceiptIfNeeded()
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Falha ao enviar comprovante'
      setSaving(false)
      setError(message)
      return
    }

    const payload = {
      title: form.title,
      category: form.category,
      amount: inputToApiMoney(form.amount),
      expenseDate: form.expenseDate,
      obraId: form.obraId ? Number(form.obraId) : null,
      vendorName: form.vendorName,
      receiptNumber: form.receiptNumber,
      receiptTotal: ocrSuggestedTotalCents !== null ? centsToInputMoney(ocrSuggestedTotalCents) : null,
      receiptImageUrl: receiptMeta?.url ?? null,
      receiptImagePublicId: receiptMeta?.publicId ?? null,
      receiptImageFormat: receiptMeta?.format ?? null,
      receiptImageBytes: receiptMeta?.bytes ?? null,
      receiptImageWidth: receiptMeta?.width ?? null,
      receiptImageHeight: receiptMeta?.height ?? null,
      notes: form.notes,
      receiptOcrText: form.receiptOcrText,
    }

    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Falha ao registrar gasto')
      return
    }

    const obraName = obras.find((obra) => obra.id === data.obra_id)?.name ?? null
    setExpenses((prev) => [{ ...data, obra_name: obraName }, ...prev])
    setForm((prev) => ({
      ...prev,
      title: '',
      amount: '',
      vendorName: '',
      receiptNumber: '',
      notes: '',
      receiptOcrText: '',
      obraId: '',
    }))
    setReceiptImage(null)
    setReceiptImagePreview(null)
    setUploadedReceipt(null)
    setOcrSuggestedTotalCents(null)
    setOcrMessage(null)
    setOcrProgress(0)
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <section className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80 mb-2">Controle Financeiro</p>
            <h1 className="text-3xl font-bold text-slate-50">💸 Gastos da obra</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300">
              Lance despesas manuais agora e prepare o fluxo para OCR: o usuário fotografa o comprovante,
              o sistema sugere valor total, fornecedor e número do documento, e o gestor apenas confirma.
            </p>
            {auth && (
              <p className="mt-3 text-xs text-slate-400">
                Cliente atual: <span className="font-medium text-slate-200">{auth.fullName || auth.username}</span>
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-full lg:min-w-[420px]">
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">Lançamentos</p>
              <p className="mt-2 text-2xl font-bold text-white">{loading ? '…' : expenses.length}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">Total registrado</p>
              <p className="mt-2 text-2xl font-bold text-emerald-400">{loading ? '…' : formatMoney(totalExpenses)}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">Prontos para OCR</p>
              <p className="mt-2 text-2xl font-bold text-amber-300">{loading ? '…' : withReceiptText}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1.35fr] gap-6">
        <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-100">Novo gasto</h2>
            <p className="text-sm text-slate-400">Agora o sistema já consegue ler a foto do comprovante no navegador e sugerir o valor total.</p>
          </div>

          <form onSubmit={submitExpense} className="space-y-4">
            <div className="rounded-xl border border-dashed border-amber-400/30 bg-amber-500/5 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1.5">Foto do comprovante</label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleReceiptFileChange}
                      className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-md file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:font-medium file:text-slate-950 hover:file:bg-amber-400"
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={runReceiptOcr}
                      disabled={!receiptImage || ocrRunning}
                      className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {ocrRunning ? `Lendo comprovante... ${ocrProgress}%` : 'Ler comprovante com OCR'}
                    </button>
                    {ocrSuggestedTotalCents !== null && (
                      <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                        Total sugerido: <span className="font-semibold">{formatMoney(ocrSuggestedTotalCents)}</span>
                      </div>
                    )}
                    {uploadedReceipt && (
                      <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                        Comprovante enviado para storage.
                      </div>
                    )}
                  </div>

                  {ocrMessage && <p className="text-sm text-slate-300">{ocrMessage}</p>}
                  {uploadingReceipt && <p className="text-sm text-sky-300">Enviando comprovante para storage...</p>}
                  <p className="text-xs text-slate-500">
                    Fluxo atual: a imagem é lida no navegador, o texto é extraído e o gestor confirma os campos antes de salvar.
                  </p>
                </div>

                <div className="w-full lg:w-44 lg:flex-shrink-0">
                  {receiptImagePreview ? (
                    <img
                      src={receiptImagePreview}
                      alt="Pré-visualização do comprovante"
                      className="h-40 w-full rounded-xl border border-slate-700 object-cover"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 text-center text-xs text-slate-500">
                      A prévia da foto aparece aqui.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Descrição</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Ex.: Compra de cimento e ferragens"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Categoria</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Valor</label>
                <input
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Ex.: 259,90"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Data</label>
                <input
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, expenseDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Obra</label>
                <select
                  value={form.obraId}
                  onChange={(e) => setForm((prev) => ({ ...prev, obraId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                >
                  <option value="">Sem vínculo específico</option>
                  {obras.map((obra) => (
                    <option key={obra.id} value={obra.id}>{obra.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Fornecedor</label>
                <input
                  value={form.vendorName}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendorName: e.target.value }))}
                  placeholder="Ex.: Casa do Construtor"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">Número do comprovante</label>
                <input
                  value={form.receiptNumber}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiptNumber: e.target.value }))}
                  placeholder="Ex.: NFC-e 000123"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Texto OCR revisado</label>
              <textarea
                rows={4}
                value={form.receiptOcrText}
                onChange={(e) => setForm((prev) => ({ ...prev, receiptOcrText: e.target.value }))}
                placeholder="O texto extraído da foto cai aqui para revisão antes do salvamento."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Observações</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Contexto da compra, urgência, forma de pagamento..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Registrar gasto'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Lançamentos recentes</h2>
              <p className="text-sm text-slate-400">Histórico pronto para evoluir para foto + OCR + conferência humana.</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-700 bg-slate-900/60" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
              <p className="text-slate-300 font-medium">Nenhum gasto registrado ainda.</p>
              <p className="mt-2 text-sm text-slate-500">A primeira fase já organiza os lançamentos. A segunda conecta a foto do comprovante ao OCR.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => (
                <article key={expense.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-100">{expense.title}</h3>
                        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-amber-200">
                          {CATEGORY_OPTIONS.find((option) => option.value === expense.category)?.label ?? expense.category}
                        </span>
                        {expense.ocr_status !== 'pending' && (
                          <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-sky-200">
                            {expense.ocr_status}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">
                        {expense.vendor_name || 'Fornecedor não informado'}
                        {expense.obra_name ? ` · ${expense.obra_name}` : ' · Sem obra vinculada'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Data: {new Date(`${expense.expense_date}T00:00:00`).toLocaleDateString('pt-BR')}
                        {expense.receipt_number ? ` · Documento: ${expense.receipt_number}` : ''}
                        {expense.receipt_uploaded_at ? ` · Imagem salva` : ''}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-xl font-bold text-emerald-400">{formatMoney(expense.amount_cents)}</p>
                      {expense.receipt_total_cents !== null && (
                        <p className="text-xs text-slate-500">OCR sugeriu {formatMoney(expense.receipt_total_cents)}</p>
                      )}
                    </div>
                  </div>

                  {(expense.notes || expense.receipt_ocr_text) && (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {expense.notes && (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                          <p className="mb-1 text-xs uppercase tracking-widest text-slate-500">Observações</p>
                          {expense.notes}
                        </div>
                      )}
                      {expense.receipt_ocr_text && (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                          <p className="mb-1 text-xs uppercase tracking-widest text-slate-500">Texto OCR</p>
                          <p className="line-clamp-4 whitespace-pre-wrap">{expense.receipt_ocr_text}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {expense.receipt_image_url && (
                    <div className="mt-3">
                      <a
                        href={expense.receipt_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-sky-300 transition hover:border-sky-400 hover:text-sky-200"
                      >
                        Ver comprovante salvo
                      </a>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}