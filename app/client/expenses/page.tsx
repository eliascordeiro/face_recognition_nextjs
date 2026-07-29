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
  receipt_classification_source: 'ai' | 'heuristic' | null
  receipt_classification_reason: string | null
  receipt_classification_confidence: number | null
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

interface ExpenseAuditEntry {
  id: number
  expense_id: number
  action: 'create' | 'update' | 'delete'
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  created_at: string
  actor_user_id: number | null
  actor_username: string | null
  actor_full_name: string | null
  expense_title?: string | null
}

interface AuditUserOption {
  value: string
  label: string
}

interface ExpenseListResponse {
  items: Expense[]
  pagination?: {
    limit: number
    offset: number
    total: number
    hasMore: boolean
  }
  summary?: {
    totalAmountCents: number
    withImageCount: number
    withOcrCount: number
  }
}

interface OcrClassificationSuggestion {
  category: string
  vendorName: string | null
  amountCents: number | null
  receiptNumber: string | null
  expenseDate: string | null
  title: string | null
  confidence: number
  warnings: string[]
}

interface OcrClassificationResult {
  source?: 'ai' | 'heuristic'
  suggestion?: OcrClassificationSuggestion
  fallbackReason?: string | null
  diagnostics?: {
    reason?: string
    statusCode?: number
  }
  error?: string
  receipt_classification_source?: 'ai' | 'heuristic'
  receipt_classification_reason?: string | null
  receipt_classification_confidence?: number | null
}

type ExpenseSortOption = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'title_asc'
type AuditSortOption = 'recent_desc' | 'recent_asc' | 'action_asc' | 'user_asc'

const EMPTY_FORM = {
  title: '',
  category: 'material',
  amount: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  obraId: '',
  vendorName: '',
  receiptNumber: '',
  notes: '',
  receiptOcrText: '',
}

const CATEGORY_OPTIONS = [
  { value: 'material', label: 'Material' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'equipamento', label: 'Equipamento' },
  { value: 'servico', label: 'Serviço' },
  { value: 'outros', label: 'Outros' },
]

const CLASSIFICATION_REASON_LABELS: Record<string, string> = {
  disabled: 'Classificação por IA desabilitada',
  missing_api_key: 'Chave de IA não configurada',
  timeout: 'Tempo de resposta excedido',
  invalid_api_key: 'Chave de IA inválida',
  insufficient_quota: 'Sem saldo ou quota insuficiente',
  rate_limited: 'Limite de requisições excedido',
  provider_error: 'Erro no provedor de IA',
  invalid_response: 'Resposta inválida do provedor',
  request_error: 'Erro de requisição para IA',
  ok: 'Classificação com IA concluída',
}

function formatMoney(cents: number | null | undefined) {
  const value = (cents ?? 0) / 100
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function getCategoryLabel(value: string) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function getClassificationSourceLabel(source: Expense['receipt_classification_source']) {
  if (source === 'ai') return 'IA'
  if (source === 'heuristic') return 'Heurística'
  return null
}

function getClassificationReasonLabel(reason: Expense['receipt_classification_reason']) {
  if (!reason) return null
  return CLASSIFICATION_REASON_LABELS[reason] ?? reason
}

function escapeCsv(value: string | number | null | undefined) {
  const normalized = value == null ? '' : String(value)
  return `"${normalized.replace(/"/g, '""')}"`
}

function describeAuditAction(action: ExpenseAuditEntry['action']) {
  if (action === 'create') return 'Criação'
  if (action === 'update') return 'Edição'
  return 'Exclusão'
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  title: 'Descrição',
  category: 'Categoria',
  vendor_name: 'Fornecedor',
  amount_cents: 'Valor',
  expense_date: 'Data',
  notes: 'Observações',
  receipt_number: 'Documento',
  receipt_total_cents: 'Valor OCR',
  receipt_ocr_text: 'Texto OCR',
  obra_id: 'Obra',
  receipt_image_url: 'Comprovante',
}

function formatAuditValue(field: string, value: unknown) {
  if (value == null || value === '') return 'vazio'

  if (field === 'amount_cents' || field === 'receipt_total_cents') {
    return formatMoney(typeof value === 'number' ? value : Number(value))
  }

  if (field === 'category') {
    return getCategoryLabel(String(value))
  }

  if (field === 'expense_date') {
    const normalized = String(value)
    const parsed = new Date(`${normalized}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? normalized : parsed.toLocaleDateString('pt-BR')
  }

  if (field === 'obra_id') {
    if (value == null || value === '') return 'Sem obra vinculada'
    return `Obra #${String(value)}`
  }

  if (field === 'receipt_image_url') {
    return value ? 'Com comprovante salvo' : 'Sem comprovante'
  }

  const text = String(value)
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function getAuditFieldDiffs(entry: ExpenseAuditEntry) {
  if (!entry.before_state || !entry.after_state) return []

  return Object.keys(AUDIT_FIELD_LABELS)
    .filter((key) => JSON.stringify(entry.before_state?.[key] ?? null) !== JSON.stringify(entry.after_state?.[key] ?? null))
    .map((key) => ({
      key,
      label: AUDIT_FIELD_LABELS[key],
      before: formatAuditValue(key, entry.before_state?.[key]),
      after: formatAuditValue(key, entry.after_state?.[key]),
    }))
}

function getAuditActorLabel(entry: ExpenseAuditEntry) {
  return entry.actor_full_name || entry.actor_username || 'Usuário não identificado'
}

function describeChangedFields(entry: ExpenseAuditEntry) {
  if (!entry.before_state || !entry.after_state) return []
  return Object.keys(AUDIT_FIELD_LABELS).filter((key) => {
    const before = entry.before_state?.[key]
    const after = entry.after_state?.[key]
    return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)
  }).map((key) => AUDIT_FIELD_LABELS[key])
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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debouncedValue
}

export default function ExpensesPage() {
  const auth = useClientAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [obras, setObras] = useState<ObraOption[]>([])
  const [loading, setLoading] = useState(true)
  const [expenseLoadingMore, setExpenseLoadingMore] = useState(false)
  const [expenseOffset, setExpenseOffset] = useState(0)
  const [expenseTotalCount, setExpenseTotalCount] = useState(0)
  const [expensePageSize] = useState(12)
  const [expenseHasMore, setExpenseHasMore] = useState(false)
  const [expenseSummary, setExpenseSummary] = useState({ totalAmountCents: 0, withImageCount: 0, withOcrCount: 0 })
  const [expenseRefreshToken, setExpenseRefreshToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ocrMessage, setOcrMessage] = useState<string | null>(null)
  const [classificationMessage, setClassificationMessage] = useState<string | null>(null)
  const [classifyingReceipt, setClassifyingReceipt] = useState(false)
  const [classificationSource, setClassificationSource] = useState<'ai' | 'heuristic' | null>(null)
  const [classificationReason, setClassificationReason] = useState<string | null>(null)
  const [classificationConfidence, setClassificationConfidence] = useState<number | null>(null)
  const [classificationSuggestion, setClassificationSuggestion] = useState<OcrClassificationSuggestion | null>(null)
  const [receiptImage, setReceiptImage] = useState<File | null>(null)
  const [receiptImagePreview, setReceiptImagePreview] = useState<string | null>(null)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [uploadedReceipt, setUploadedReceipt] = useState<UploadedReceiptMeta | null>(null)
  const [ocrSuggestedTotalCents, setOcrSuggestedTotalCents] = useState<number | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null)
  const [auditEntriesByExpense, setAuditEntriesByExpense] = useState<Record<number, ExpenseAuditEntry[]>>({})
  const [recentAuditEntries, setRecentAuditEntries] = useState<ExpenseAuditEntry[]>([])
  const [auditUserOptions, setAuditUserOptions] = useState<AuditUserOption[]>([])
  const [expandedAuditExpenseId, setExpandedAuditExpenseId] = useState<number | null>(null)
  const [auditLoadingExpenseId, setAuditLoadingExpenseId] = useState<number | null>(null)
  const [recentAuditLoading, setRecentAuditLoading] = useState(true)
  const [auditActionFilter, setAuditActionFilter] = useState<'all' | ExpenseAuditEntry['action']>('all')
  const [auditUserFilter, setAuditUserFilter] = useState('all')
  const [auditPeriodFilter, setAuditPeriodFilter] = useState('30d')
  const [auditSearch, setAuditSearch] = useState('')
  const [auditSort, setAuditSort] = useState<AuditSortOption>('recent_desc')
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditTotalCount, setAuditTotalCount] = useState(0)
  const [auditPageSize] = useState(8)
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [obraFilter, setObraFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('this_month')
  const [expenseSort, setExpenseSort] = useState<ExpenseSortOption>('date_desc')
  const [form, setForm] = useState(EMPTY_FORM)
  const debouncedSearch = useDebouncedValue(search, 350)
  const debouncedAuditSearch = useDebouncedValue(auditSearch, 350)

  useEffect(() => {
    let cancelled = false

    fetch('/api/obras').then(async (res) => (res.ok ? res.json() : [])).then((obraData) => {
      if (cancelled) return
      setObras(Array.isArray(obraData) ? obraData.map((obra) => ({ id: obra.id, name: obra.name })) : [])
    })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadExpensesPage() {
      setLoading(true)
      const params = new URLSearchParams({
        q: debouncedSearch.trim(),
        category: categoryFilter,
        obra: obraFilter === '' ? 'none' : obraFilter,
        period: periodFilter,
        sort: expenseSort,
        limit: String(expensePageSize),
        offset: '0',
      })

      const res = await fetch(`/api/expenses?${params.toString()}`)
      const data = await res.json().catch(() => null) as ExpenseListResponse | null
      if (cancelled) return

      if (!res.ok || !data) {
        setExpenses([])
        setExpenseOffset(0)
        setExpenseTotalCount(0)
        setExpenseHasMore(false)
        setExpenseSummary({ totalAmountCents: 0, withImageCount: 0, withOcrCount: 0 })
        setLoading(false)
        return
      }

      const items = Array.isArray(data.items) ? data.items : []
      const total = typeof data.pagination?.total === 'number' ? data.pagination.total : items.length
      setExpenses(items)
      setExpenseOffset(items.length)
      setExpenseTotalCount(total)
      setExpenseHasMore(Boolean(data.pagination?.hasMore))
      setExpenseSummary({
        totalAmountCents: typeof data.summary?.totalAmountCents === 'number' ? data.summary.totalAmountCents : 0,
        withImageCount: typeof data.summary?.withImageCount === 'number' ? data.summary.withImageCount : 0,
        withOcrCount: typeof data.summary?.withOcrCount === 'number' ? data.summary.withOcrCount : 0,
      })
      setLoading(false)
    }

    loadExpensesPage()

    return () => { cancelled = true }
  }, [debouncedSearch, categoryFilter, obraFilter, periodFilter, expenseSort, expensePageSize, expenseRefreshToken])

  useEffect(() => {
    let cancelled = false

    async function loadAudit(append: boolean) {
      setRecentAuditLoading(true)
      const nextOffset = append ? auditOffset : 0
      const params = new URLSearchParams({
        action: auditActionFilter,
        actor: auditUserFilter,
        period: auditPeriodFilter,
        q: debouncedAuditSearch,
        limit: String(auditPageSize),
        offset: String(nextOffset),
      })

      const res = await fetch(`/api/expenses/audit?${params.toString()}`)
      const data = await res.json().catch(() => null)
      if (cancelled) return

      if (!res.ok || !data) {
        setRecentAuditEntries([])
        setRecentAuditLoading(false)
        return
      }

      const entries = Array.isArray(data.entries) ? data.entries : []
      setRecentAuditEntries((prev) => (append ? [...prev, ...entries] : entries))
      setAuditUserOptions(Array.isArray(data.users) ? data.users : [])
      setAuditTotalCount(typeof data.total === 'number' ? data.total : 0)
      setAuditHasMore(nextOffset + entries.length < (typeof data.total === 'number' ? data.total : 0))
      setAuditOffset(nextOffset + entries.length)
      setRecentAuditLoading(false)
    }

    loadAudit(false)

    return () => { cancelled = true }
  }, [auditActionFilter, auditUserFilter, auditPeriodFilter, debouncedAuditSearch, auditPageSize])

  const filteredExpenses = expenses

  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, expense) => sum + expense.amount_cents, 0),
    [filteredExpenses]
  )

  const categorySummary = useMemo(() => {
    const grouped = new Map<string, { label: string; count: number; totalCents: number }>()
    for (const expense of filteredExpenses) {
      const key = expense.category
      const current = grouped.get(key) ?? { label: getCategoryLabel(key), count: 0, totalCents: 0 }
      current.count += 1
      current.totalCents += expense.amount_cents
      grouped.set(key, current)
    }
    return Array.from(grouped.values()).sort((a, b) => b.totalCents - a.totalCents)
  }, [filteredExpenses])

  const obraSummary = useMemo(() => {
    const grouped = new Map<string, { label: string; count: number; totalCents: number }>()
    for (const expense of filteredExpenses) {
      const key = String(expense.obra_id ?? 'none')
      const label = expense.obra_name ?? 'Sem obra vinculada'
      const current = grouped.get(key) ?? { label, count: 0, totalCents: 0 }
      current.count += 1
      current.totalCents += expense.amount_cents
      grouped.set(key, current)
    }
    return Array.from(grouped.values()).sort((a, b) => b.totalCents - a.totalCents)
  }, [filteredExpenses])

  const recentAuditSummary = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const entry of recentAuditEntries) {
      grouped.set(entry.action, (grouped.get(entry.action) ?? 0) + 1)
    }
    return {
      create: grouped.get('create') ?? 0,
      update: grouped.get('update') ?? 0,
      delete: grouped.get('delete') ?? 0,
    }
  }, [recentAuditEntries])

  const sortedRecentAuditEntries = useMemo(() => {
    return [...recentAuditEntries].sort((left, right) => {
      if (auditSort === 'recent_desc') {
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime() || right.id - left.id
      }
      if (auditSort === 'recent_asc') {
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime() || left.id - right.id
      }
      if (auditSort === 'action_asc') {
        return describeAuditAction(left.action).localeCompare(describeAuditAction(right.action), 'pt-BR')
      }
      return getAuditActorLabel(left).localeCompare(getAuditActorLabel(right), 'pt-BR')
    })
  }, [recentAuditEntries, auditSort])

  async function loadMoreExpenses() {
    if (expenseLoadingMore || !expenseHasMore) return

    setExpenseLoadingMore(true)
    const params = new URLSearchParams({
      q: debouncedSearch.trim(),
      category: categoryFilter,
      obra: obraFilter === '' ? 'none' : obraFilter,
      period: periodFilter,
      sort: expenseSort,
      limit: String(expensePageSize),
      offset: String(expenseOffset),
    })

    const res = await fetch(`/api/expenses?${params.toString()}`)
    const data = await res.json().catch(() => null) as ExpenseListResponse | null
    if (!res.ok || !data) {
      setExpenseLoadingMore(false)
      return
    }

    const items = Array.isArray(data.items) ? data.items : []
    const total = typeof data.pagination?.total === 'number' ? data.pagination.total : expenseTotalCount
    setExpenses((prev) => [...prev, ...items])
    setExpenseOffset((prev) => prev + items.length)
    setExpenseTotalCount(total)
    setExpenseHasMore(Boolean(data.pagination?.hasMore))
    setExpenseSummary((prev) => ({
      totalAmountCents: typeof data.summary?.totalAmountCents === 'number' ? data.summary.totalAmountCents : prev.totalAmountCents,
      withImageCount: typeof data.summary?.withImageCount === 'number' ? data.summary.withImageCount : prev.withImageCount,
      withOcrCount: typeof data.summary?.withOcrCount === 'number' ? data.summary.withOcrCount : prev.withOcrCount,
    }))
    setExpenseLoadingMore(false)
  }

  async function loadMoreAuditEntries() {
    setRecentAuditLoading(true)
    const params = new URLSearchParams({
      action: auditActionFilter,
      actor: auditUserFilter,
      period: auditPeriodFilter,
      q: debouncedAuditSearch,
      limit: String(auditPageSize),
      offset: String(auditOffset),
    })

    const res = await fetch(`/api/expenses/audit?${params.toString()}`)
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) {
      setRecentAuditLoading(false)
      return
    }

    const entries = Array.isArray(data.entries) ? data.entries : []
    setRecentAuditEntries((prev) => [...prev, ...entries])
    setAuditTotalCount(typeof data.total === 'number' ? data.total : 0)
    setAuditHasMore(auditOffset + entries.length < (typeof data.total === 'number' ? data.total : 0))
    setAuditOffset(auditOffset + entries.length)
    setRecentAuditLoading(false)
  }

  function exportAuditCsv() {
    const headers = [
      'DataHora',
      'Acao',
      'Gasto',
      'Usuario',
      'Campos alterados',
    ]

    const lines = recentAuditEntries.map((entry) => [
      new Date(entry.created_at).toLocaleString('pt-BR'),
      describeAuditAction(entry.action),
      entry.expense_title || (entry.expense_id ? `Gasto #${entry.expense_id}` : 'Gasto removido'),
      getAuditActorLabel(entry),
      describeChangedFields(entry).join(', '),
    ])

    const csv = [headers, ...lines]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(';'))
      .join('\n')

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateLabel = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `auditoria-gastos-${auditPeriodFilter}-${dateLabel}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function exportAuditPdf() {
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const autoTable = autoTableModule.default
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })

    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, 595, 100, 'F')
    doc.setTextColor(248, 250, 252)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text('Auditoria de Gastos', 40, 42)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 64)
    doc.text(`Cliente: ${auth?.fullName || auth?.username || 'Cliente'}`, 40, 80)

    autoTable(doc, {
      startY: 120,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235] },
      head: [['Indicador', 'Valor']],
      body: [
        ['Entradas carregadas', String(recentAuditEntries.length)],
        ['Total no recorte', String(auditTotalCount)],
        ['Criações (carregadas)', String(recentAuditSummary.create)],
        ['Edições (carregadas)', String(recentAuditSummary.update)],
        ['Exclusões (carregadas)', String(recentAuditSummary.delete)],
      ],
    })

    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18) : 220,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59] },
      head: [['Data/Hora', 'Ação', 'Gasto', 'Usuário', 'Campos alterados']],
      body: recentAuditEntries.length > 0
        ? recentAuditEntries.map((entry) => [
            new Date(entry.created_at).toLocaleString('pt-BR'),
            describeAuditAction(entry.action),
            entry.expense_title || (entry.expense_id ? `Gasto #${entry.expense_id}` : 'Gasto removido'),
            getAuditActorLabel(entry),
            describeChangedFields(entry).join(', ') || '-',
          ])
        : [['-', '-', 'Sem atividade no recorte', '-', '-']],
    })

    const dateLabel = new Date().toISOString().slice(0, 10)
    doc.save(`auditoria-gastos-${auditPeriodFilter}-${dateLabel}.pdf`)
  }

  function exportFilteredExpensesCsv() {
    const headers = [
      'Data',
      'Descricao',
      'Categoria',
      'Obra',
      'Fornecedor',
      'Valor',
      'Documento',
      'Valor OCR',
      'Status OCR',
      'Comprovante URL',
      'Observacoes',
    ]

    const lines = filteredExpenses.map((expense) => [
      expense.expense_date,
      expense.title,
      CATEGORY_OPTIONS.find((option) => option.value === expense.category)?.label ?? expense.category,
      expense.obra_name ?? 'Sem obra vinculada',
      expense.vendor_name ?? '',
      (expense.amount_cents / 100).toFixed(2).replace('.', ','),
      expense.receipt_number ?? '',
      expense.receipt_total_cents != null ? (expense.receipt_total_cents / 100).toFixed(2).replace('.', ',') : '',
      expense.ocr_status,
      expense.receipt_image_url ?? '',
      expense.notes ?? '',
    ])

    const csv = [headers, ...lines]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(';'))
      .join('\n')

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateLabel = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `gastos-${periodFilter}-${dateLabel}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function exportFilteredExpensesPdf() {
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const autoTable = autoTableModule.default
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })

    const generatedAt = new Date().toLocaleString('pt-BR')
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, 595, 110, 'F')
    doc.setTextColor(248, 250, 252)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text('Relatorio de Gastos', 40, 44)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(`Gerado em ${generatedAt}`, 40, 66)
    doc.text(`Cliente: ${auth?.fullName || auth?.username || 'Cliente'}`, 40, 84)

    doc.setTextColor(51, 65, 85)
    doc.setFontSize(10)
    doc.text(`Filtros: periodo=${periodFilter} | categoria=${categoryFilter} | obra=${obraFilter} | busca=${search || 'sem filtro textual'}`, 40, 132)

    autoTable(doc, {
      startY: 148,
      theme: 'grid',
      headStyles: { fillColor: [245, 158, 11], textColor: [15, 23, 42] },
      bodyStyles: { textColor: [30, 41, 59] },
      head: [['Indicador', 'Valor']],
      body: [
        ['Lancamentos no filtro', String(expenseTotalCount)],
        ['Lancamentos carregados', String(filteredExpenses.length)],
        ['Total do filtro', formatMoney(expenseSummary.totalAmountCents)],
        ['Com comprovante', String(expenseSummary.withImageCount)],
        ['Com OCR', String(expenseSummary.withOcrCount)],
      ],
    })

    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18) : 260,
      theme: 'striped',
      headStyles: { fillColor: [14, 116, 144] },
      head: [['Resumo por categoria', 'Lancamentos', 'Total']],
      body: categorySummary.length > 0
        ? categorySummary.map((item) => [item.label, String(item.count), formatMoney(item.totalCents)])
        : [['Sem dados', '0', formatMoney(0)]],
    })

    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18) : 360,
      theme: 'striped',
      headStyles: { fillColor: [5, 150, 105] },
      head: [['Resumo por obra', 'Lancamentos', 'Total']],
      body: obraSummary.length > 0
        ? obraSummary.map((item) => [item.label, String(item.count), formatMoney(item.totalCents)])
        : [['Sem dados', '0', formatMoney(0)]],
    })

    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18) : 460,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59] },
      head: [['Data', 'Descricao', 'Categoria', 'Obra', 'Fornecedor', 'Valor', 'Documento']],
      body: filteredExpenses.length > 0
        ? filteredExpenses.map((expense) => [
            new Date(`${expense.expense_date}T00:00:00`).toLocaleDateString('pt-BR'),
            expense.title,
            getCategoryLabel(expense.category),
            expense.obra_name ?? 'Sem obra',
            expense.vendor_name ?? '-',
            formatMoney(expense.amount_cents),
            expense.receipt_number ?? '-',
          ])
        : [['-', 'Nenhum gasto no recorte', '-', '-', '-', '-', '-']],
    })

    const dateLabel = new Date().toISOString().slice(0, 10)
    doc.save(`relatorio-gastos-${periodFilter}-${dateLabel}.pdf`)
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM, expenseDate: new Date().toISOString().slice(0, 10) })
    setEditingExpenseId(null)
    setReceiptImage(null)
    setReceiptImagePreview(null)
    setUploadedReceipt(null)
    setOcrSuggestedTotalCents(null)
    setOcrMessage(null)
    setClassificationMessage(null)
    setClassifyingReceipt(false)
    setClassificationSource(null)
    setClassificationReason(null)
    setClassificationConfidence(null)
    setClassificationSuggestion(null)
    setOcrProgress(0)
    setError(null)
  }

  function startEditing(expense: Expense) {
    setEditingExpenseId(expense.id)
    setForm({
      title: expense.title,
      category: expense.category,
      amount: centsToInputMoney(expense.amount_cents),
      expenseDate: expense.expense_date,
      obraId: expense.obra_id ? String(expense.obra_id) : '',
      vendorName: expense.vendor_name ?? '',
      receiptNumber: expense.receipt_number ?? '',
      notes: expense.notes ?? '',
      receiptOcrText: expense.receipt_ocr_text ?? '',
    })
    setUploadedReceipt(expense.receipt_image_url ? {
      url: expense.receipt_image_url,
      publicId: expense.receipt_image_public_id ?? '',
      format: expense.receipt_image_format,
      bytes: expense.receipt_image_bytes,
      width: expense.receipt_image_width,
      height: expense.receipt_image_height,
    } : null)
    setReceiptImage(null)
    setReceiptImagePreview(expense.receipt_image_url)
    setOcrSuggestedTotalCents(expense.receipt_total_cents)
    setOcrMessage(null)
    setClassificationMessage(null)
    setClassifyingReceipt(false)
    setClassificationSource(expense.receipt_classification_source)
    setClassificationReason(expense.receipt_classification_reason)
    setClassificationConfidence(expense.receipt_classification_confidence)
    setClassificationSuggestion(expense.receipt_classification_source
      ? {
          category: expense.category,
          vendorName: expense.vendor_name,
          amountCents: expense.receipt_total_cents,
          receiptNumber: expense.receipt_number,
          expenseDate: expense.expense_date,
          title: expense.title,
          confidence: expense.receipt_classification_confidence ?? 0,
          warnings: [],
        }
      : null)
    setOcrProgress(0)
    setError(null)
  }

  function handleReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setReceiptImage(file)
    setOcrMessage(null)
    setClassificationMessage(null)
    setClassifyingReceipt(false)
    setClassificationSource(null)
    setClassificationReason(null)
    setClassificationConfidence(null)
    setClassificationSuggestion(null)
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

  function applyClassificationSuggestion(suggestion: OcrClassificationSuggestion) {
    setForm((prev) => ({
      ...prev,
      category: suggestion.category || prev.category,
      title: prev.title || suggestion.title || prev.title,
      vendorName: prev.vendorName || suggestion.vendorName || prev.vendorName,
      receiptNumber: prev.receiptNumber || suggestion.receiptNumber || prev.receiptNumber,
      expenseDate: suggestion.expenseDate || prev.expenseDate,
      amount: prev.amount || (suggestion.amountCents !== null ? centsToInputMoney(suggestion.amountCents) : prev.amount),
    }))
    if (suggestion.amountCents !== null && suggestion.amountCents > 0) {
      setOcrSuggestedTotalCents(suggestion.amountCents)
    }
  }

  async function classifyOcrText(ocrText: string) {
    setClassifyingReceipt(true)
    setClassificationMessage('Classificando texto OCR...')

    try {
      const response = await fetch('/api/expenses/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocrText }),
      })
      const data = await response.json().catch(() => null) as OcrClassificationResult | null

      if (!response.ok || !data?.suggestion) {
        setClassificationMessage(data?.error ?? 'Classificação indisponível no momento.')
        return
      }

      setClassificationSource(data.source ?? 'heuristic')
      setClassificationReason(data.fallbackReason ?? data.diagnostics?.reason ?? null)
      setClassificationConfidence(data.suggestion.confidence ?? null)
      setClassificationSuggestion(data.suggestion)
      applyClassificationSuggestion(data.suggestion)

      const confidencePercent = Math.round((data.suggestion.confidence ?? 0) * 100)
      const fallbackReason = data.fallbackReason
      const fallbackHint = fallbackReason
        ? ` (motivo: ${fallbackReason})`
        : ''
      setClassificationMessage(
        data.source === 'ai'
          ? `Classificação por IA aplicada (${confidencePercent}% de confiança).`
          : `Classificação heurística aplicada (${confidencePercent}% de confiança)${fallbackHint}.`
      )
    } catch {
      setClassificationMessage('Falha ao classificar o texto OCR.')
    } finally {
      setClassifyingReceipt(false)
    }
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

      if (recognizedText.length >= 12) {
        await classifyOcrText(recognizedText)
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
      receiptClassificationSource: classificationSource,
      receiptClassificationReason: classificationReason,
      receiptClassificationConfidence: classificationConfidence ?? classificationSuggestion?.confidence ?? null,
    }

    const isEditing = editingExpenseId !== null
    const res = await fetch(isEditing ? `/api/expenses/${editingExpenseId}` : '/api/expenses', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Falha ao registrar gasto')
      return
    }

    resetForm()
    setExpenseRefreshToken((prev) => prev + 1)
  }

  async function deleteExpense(expense: Expense) {
    if (!confirm(`Remover o gasto "${expense.title}"? Essa ação não pode ser desfeita.`)) return

    const res = await fetch(`/api/expenses/${expense.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Falha ao remover gasto' }))
      setError(data.error ?? 'Falha ao remover gasto')
      return
    }

    setExpenseRefreshToken((prev) => prev + 1)
    setRecentAuditEntries((prev) => prev.filter((entry) => entry.expense_id !== expense.id || entry.action !== 'delete'))
    if (editingExpenseId === expense.id) {
      resetForm()
    }
    setAuditEntriesByExpense((prev) => {
      const next = { ...prev }
      delete next[expense.id]
      return next
    })
    if (expandedAuditExpenseId === expense.id) {
      setExpandedAuditExpenseId(null)
    }
  }

  async function toggleAuditHistory(expenseId: number) {
    if (expandedAuditExpenseId === expenseId) {
      setExpandedAuditExpenseId(null)
      return
    }

    setExpandedAuditExpenseId(expenseId)
    if (auditEntriesByExpense[expenseId]) return

    setAuditLoadingExpenseId(expenseId)
    try {
      const res = await fetch(`/api/expenses/${expenseId}/audit`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Falha ao carregar auditoria')
      }
      setAuditEntriesByExpense((prev) => ({ ...prev, [expenseId]: Array.isArray(data) ? data : [] }))
    } catch (auditError) {
      const message = auditError instanceof Error ? auditError.message : 'Falha ao carregar auditoria'
      setError(message)
      setExpandedAuditExpenseId(null)
    } finally {
      setAuditLoadingExpenseId(null)
    }
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
              <p className="text-xs uppercase tracking-widest text-slate-500">No recorte</p>
              <p className="mt-2 text-2xl font-bold text-white">{loading ? '…' : expenseTotalCount}</p>
              <p className="mt-1 text-xs text-slate-500">Carregados: {filteredExpenses.length}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">Total filtrado</p>
              <p className="mt-2 text-2xl font-bold text-emerald-400">{loading ? '…' : formatMoney(expenseSummary.totalAmountCents)}</p>
              <p className="mt-1 text-xs text-slate-500">Carregados: {formatMoney(filteredTotal)}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">Com comprovante</p>
              <p className="mt-2 text-2xl font-bold text-amber-300">{loading ? '…' : expenseSummary.withImageCount}</p>
              <p className="mt-1 text-xs text-slate-500">Com OCR: {expenseSummary.withOcrCount}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Filtros e análise</h2>
            <p className="text-sm text-slate-400">Refine os gastos por obra, categoria, período ou texto livre.</p>
          </div>
          <button
            type="button"
            onClick={exportFilteredExpensesCsv}
            disabled={filteredExpenses.length === 0}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Exportar CSV do recorte
          </button>
          <button
            type="button"
            onClick={exportFilteredExpensesPdf}
            disabled={filteredExpenses.length === 0}
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Exportar PDF do recorte
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Busca</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Descrição, fornecedor, obra..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Categoria</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            >
              <option value="all">Todas</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Obra</label>
            <select
              value={obraFilter}
              onChange={(e) => setObraFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            >
              <option value="all">Todas as obras</option>
              <option value="">Sem obra vinculada</option>
              {obras.map((obra) => (
                <option key={obra.id} value={String(obra.id)}>{obra.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Período</label>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            >
              <option value="all">Todo o histórico</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="this_month">Este mês</option>
              <option value="last_month">Mês anterior</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Atividade recente da auditoria</h2>
            <p className="text-sm text-slate-400">Visão geral das últimas alterações financeiras do cliente.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportAuditCsv}
              disabled={recentAuditEntries.length === 0}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar auditoria CSV
            </button>
            <button
              type="button"
              onClick={exportAuditPdf}
              disabled={recentAuditEntries.length === 0}
              className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar auditoria PDF
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Criações</p>
              <p className="text-lg font-semibold text-emerald-300">{recentAuditSummary.create}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Edições</p>
              <p className="text-lg font-semibold text-amber-300">{recentAuditSummary.update}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Exclusões</p>
              <p className="text-lg font-semibold text-red-300">{recentAuditSummary.delete}</p>
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Ação</label>
            <select
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value as 'all' | ExpenseAuditEntry['action'])}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="all">Todas</option>
              <option value="create">Criação</option>
              <option value="update">Edição</option>
              <option value="delete">Exclusão</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Usuário</label>
            <select
              value={auditUserFilter}
              onChange={(e) => setAuditUserFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="all">Todos</option>
              {auditUserOptions.map((user) => (
                <option key={user.value} value={user.value}>{user.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Período</label>
            <select
              value={auditPeriodFilter}
              onChange={(e) => setAuditPeriodFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="all">Todo o histórico carregado</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="this_month">Este mês</option>
              <option value="last_month">Mês anterior</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">Ordenação</label>
            <select
              value={auditSort}
              onChange={(e) => setAuditSort(e.target.value as AuditSortOption)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="recent_desc">Mais recentes primeiro</option>
              <option value="recent_asc">Mais antigas primeiro</option>
              <option value="action_asc">Ação (A-Z)</option>
              <option value="user_asc">Usuário (A-Z)</option>
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <label className="mb-1.5 block text-sm text-slate-300">Busca textual</label>
            <input
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Buscar por gasto, usuário ou ação..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
            />
          </div>
        </div>

        {recentAuditLoading ? (
          <p className="text-sm text-slate-400">Carregando atividade recente...</p>
        ) : recentAuditEntries.length === 0 ? (
          <p className="text-sm text-slate-500">Ainda não há atividade auditada para exibir.</p>
        ) : (
          <div className="space-y-3">
            {sortedRecentAuditEntries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {describeAuditAction(entry.action)}
                      {entry.expense_title ? ` · ${entry.expense_title}` : entry.expense_id ? ` · Gasto #${entry.expense_id}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.created_at).toLocaleString('pt-BR')}
                      {entry.actor_full_name || entry.actor_username ? ` · ${entry.actor_full_name || entry.actor_username}` : ''}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    entry.action === 'create'
                      ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/20'
                      : entry.action === 'update'
                        ? 'bg-amber-500/15 text-amber-200 border border-amber-400/20'
                        : 'bg-red-500/15 text-red-200 border border-red-400/20'
                  }`}>
                    {describeAuditAction(entry.action)}
                  </span>
                </div>
              </div>
            ))}
            {auditHasMore && (
              <button
                type="button"
                onClick={loadMoreAuditEntries}
                disabled={recentAuditLoading}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-sky-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recentAuditLoading ? 'Carregando...' : `Carregar mais (${recentAuditEntries.length}/${auditTotalCount})`}
              </button>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1.35fr] gap-6">
        <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-100">{editingExpenseId ? 'Editar gasto' : 'Novo gasto'}</h2>
            <p className="text-sm text-slate-400">Agora o sistema já consegue ler a foto do comprovante no navegador, sugerir o valor total e também atualizar lançamentos existentes.</p>
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
                  {classificationMessage && <p className="text-sm text-sky-300">{classificationMessage}</p>}
                  {classifyingReceipt && <p className="text-sm text-slate-300">Analisando categoria e campos do comprovante...</p>}
                  {classificationSuggestion && (
                    <div className="rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 text-sm text-sky-100">
                      <p className="font-medium">
                        Sugestão {classificationSource === 'ai' ? 'da IA' : 'heurística'}: {getCategoryLabel(classificationSuggestion.category)}
                      </p>
                      <p className="mt-1 text-xs text-sky-200/90">
                        Confiança: {Math.round((classificationSuggestion.confidence ?? 0) * 100)}%
                      </p>
                      {classificationSuggestion.warnings?.length > 0 && (
                        <p className="mt-1 text-xs text-amber-200">
                          Atenção: {classificationSuggestion.warnings.join(' ')}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => applyClassificationSuggestion(classificationSuggestion)}
                        className="mt-2 rounded-md border border-sky-300/40 px-2.5 py-1 text-xs font-medium text-sky-100 transition hover:border-sky-200 hover:bg-sky-500/20"
                      >
                        Reaplicar sugestão
                      </button>
                    </div>
                  )}
                  {uploadingReceipt && <p className="text-sm text-sky-300">Enviando comprovante para storage...</p>}
                  {editingExpenseId && uploadedReceipt?.url && !receiptImage && (
                    <p className="text-sm text-emerald-300">Este gasto já possui um comprovante salvo. Escolha outra imagem para substituir.</p>
                  )}
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

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Salvando...' : editingExpenseId ? 'Salvar alterações' : 'Registrar gasto'}
              </button>
              {editingExpenseId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-600 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-400 hover:text-white"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Lançamentos recentes</h2>
              <p className="text-sm text-slate-400">Histórico com filtros, OCR e acesso rápido ao comprovante salvo.</p>
            </div>
            <div className="w-full max-w-xs">
              <label className="mb-1.5 block text-sm text-slate-300">Ordenação</label>
              <select
                value={expenseSort}
                onChange={(e) => setExpenseSort(e.target.value as ExpenseSortOption)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
              >
                <option value="date_desc">Data mais recente</option>
                <option value="date_asc">Data mais antiga</option>
                <option value="amount_desc">Maior valor</option>
                <option value="amount_asc">Menor valor</option>
                <option value="title_asc">Descrição (A-Z)</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-700 bg-slate-900/60" />
              ))}
            </div>
          ) : filteredExpenses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
              <p className="text-slate-300 font-medium">Nenhum gasto encontrado para os filtros atuais.</p>
              <p className="mt-2 text-sm text-slate-500">Ajuste o período, a obra, a categoria ou a busca para ampliar o recorte.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredExpenses.map((expense) => (
                <article key={expense.id} className="rounded-xl border border-slate-700 bg-slate-900/65 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex gap-4">
                      {expense.receipt_image_url ? (
                        <a
                          href={expense.receipt_image_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/70 transition hover:border-sky-400"
                        >
                          <img
                            src={expense.receipt_image_url}
                            alt={`Comprovante de ${expense.title}`}
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ) : (
                        <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 text-center text-[11px] text-slate-500">
                          Sem imagem
                        </div>
                      )}

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
                        {expense.receipt_classification_source && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${
                              expense.receipt_classification_source === 'ai'
                                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                                : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                            }`}
                          >
                            {getClassificationSourceLabel(expense.receipt_classification_source)}
                            {typeof expense.receipt_classification_confidence === 'number'
                              ? ` ${Math.round(expense.receipt_classification_confidence * 100)}%`
                              : ''}
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
                      {expense.receipt_classification_reason && (
                        <p className="mt-1 text-xs text-slate-500">
                          Diagnóstico OCR: {getClassificationReasonLabel(expense.receipt_classification_reason)}
                        </p>
                      )}
                      {expense.receipt_image_bytes && (
                        <p className="mt-1 text-xs text-slate-500">
                          Arquivo: {(expense.receipt_image_bytes / 1024).toFixed(0)} KB
                          {expense.receipt_image_width && expense.receipt_image_height ? ` · ${expense.receipt_image_width}x${expense.receipt_image_height}` : ''}
                        </p>
                      )}
                      </div>
                    </div>
                    <div className="text-left lg:text-right">
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
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={expense.receipt_image_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-sky-300 transition hover:border-sky-400 hover:text-sky-200"
                        >
                          Ver comprovante salvo
                        </a>
                        <button
                          type="button"
                          onClick={() => startEditing(expense)}
                          className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-amber-400 hover:text-white"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExpense(expense)}
                          className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-200 transition hover:border-red-500 hover:text-white"
                        >
                          Excluir
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAuditHistory(expense.id)}
                          className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white"
                        >
                          {expandedAuditExpenseId === expense.id ? 'Ocultar histórico' : 'Ver histórico'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!expense.receipt_image_url && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEditing(expense)}
                        className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-amber-400 hover:text-white"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExpense(expense)}
                        className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-200 transition hover:border-red-500 hover:text-white"
                      >
                        Excluir
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAuditHistory(expense.id)}
                        className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white"
                      >
                        {expandedAuditExpenseId === expense.id ? 'Ocultar histórico' : 'Ver histórico'}
                      </button>
                    </div>
                  )}

                  {expandedAuditExpenseId === expense.id && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">Histórico de auditoria</p>
                          <p className="text-xs text-slate-500">Criação, edição e exclusão com snapshots do estado do gasto.</p>
                        </div>
                      </div>

                      {auditLoadingExpenseId === expense.id ? (
                        <p className="text-sm text-slate-400">Carregando histórico...</p>
                      ) : (auditEntriesByExpense[expense.id]?.length ?? 0) === 0 ? (
                        <p className="text-sm text-slate-500">Nenhum registro de auditoria encontrado.</p>
                      ) : (
                        <div className="space-y-3">
                          {auditEntriesByExpense[expense.id].map((entry) => {
                            const changedFields = describeChangedFields(entry)
                            const diffs = getAuditFieldDiffs(entry)
                            return (
                              <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-slate-100">{describeAuditAction(entry.action)}</p>
                                    <p className="text-xs text-slate-500">
                                      {new Date(entry.created_at).toLocaleString('pt-BR')}
                                      {entry.actor_full_name || entry.actor_username ? ` · ${entry.actor_full_name || entry.actor_username}` : ''}
                                    </p>
                                  </div>
                                  {changedFields.length > 0 && (
                                    <p className="text-xs text-sky-300">Campos alterados: {changedFields.join(', ')}</p>
                                  )}
                                </div>

                                {entry.action === 'create' && entry.after_state && (
                                  <p className="mt-2 text-xs text-slate-400">Snapshot salvo da criação do gasto.</p>
                                )}
                                {entry.action === 'delete' && entry.before_state && (
                                  <p className="mt-2 text-xs text-slate-400">Snapshot salvo antes da exclusão.</p>
                                )}
                                {diffs.length > 0 && (
                                  <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Antes e depois</p>
                                    {diffs.map((diff) => (
                                      <div key={diff.key} className="grid gap-2 md:grid-cols-[140px_1fr_1fr] md:items-start">
                                        <p className="text-xs font-medium text-slate-300">{diff.label}</p>
                                        <div className="rounded-md border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-xs text-red-100">
                                          <p className="mb-1 uppercase tracking-wider text-[10px] text-red-300">Antes</p>
                                          <p className="whitespace-pre-wrap break-words">{diff.before}</p>
                                        </div>
                                        <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 px-2 py-1.5 text-xs text-emerald-100">
                                          <p className="mb-1 uppercase tracking-wider text-[10px] text-emerald-300">Depois</p>
                                          <p className="whitespace-pre-wrap break-words">{diff.after}</p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
              {expenseHasMore && (
                <button
                  type="button"
                  onClick={loadMoreExpenses}
                  disabled={expenseLoadingMore}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-amber-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {expenseLoadingMore ? 'Carregando...' : `Carregar mais gastos (${filteredExpenses.length}/${expenseTotalCount})`}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}