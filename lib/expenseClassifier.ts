const VALID_CATEGORIES = ['material', 'alimentacao', 'transporte', 'equipamento', 'servico', 'outros'] as const

type ExpenseCategory = (typeof VALID_CATEGORIES)[number]

export interface ExpenseClassificationSuggestion {
  category: ExpenseCategory
  vendorName: string | null
  amountCents: number | null
  receiptNumber: string | null
  expenseDate: string | null
  title: string | null
  confidence: number
  warnings: string[]
}

export interface ExpenseAiDiagnostics {
  attempted: boolean
  usedAi: boolean
  reason:
    | 'disabled'
    | 'missing_api_key'
    | 'timeout'
    | 'invalid_api_key'
    | 'insufficient_quota'
    | 'rate_limited'
    | 'provider_error'
    | 'invalid_response'
    | 'request_error'
    | 'ok'
  statusCode?: number
  detail?: string
}

function normalizeText(text: string) {
  return text.replace(/\r/g, '').trim()
}

function clampConfidence(value: unknown, fallback = 0.5) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function toCents(value: string) {
  const cleaned = value.replace(/\s+/g, '').replace(/[R$r$]/g, '')
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

function parseDate(value: string) {
  const match = value.match(/\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})\b/)
  if (!match) return null
  const [, dd, mm, yy] = match
  const yyyy = yy.length === 2 ? `20${yy}` : yy
  const iso = `${yyyy}-${mm}-${dd}`
  const parsed = new Date(`${iso}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : iso
}

function inferCategory(text: string): ExpenseCategory {
  const t = text.toLowerCase()
  if (/cimento|areia|brita|ferro|tijolo|argamassa|tinta|ferragem|material/.test(t)) return 'material'
  if (/almoco|almoço|janta|refeicao|refeição|lanch|mercado|padaria|restaurante/.test(t)) return 'alimentacao'
  if (/uber|99|combustivel|combustível|gasolina|diesel|pedagio|pedágio|transporte|frete/.test(t)) return 'transporte'
  if (/furadeira|betoneira|serra|equipamento|locacao|locação|aluguel/.test(t)) return 'equipamento'
  if (/mao de obra|mão de obra|servico|serviço|instalacao|instalação|manutencao|manutenção/.test(t)) return 'servico'
  return 'outros'
}

function inferVendor(text: string) {
  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return lines.slice(0, 7).find((line) => {
    if (line.length < 5 || line.length > 64) return false
    if (/cnpj|cpf|inscri|nota|fiscal|cupom|documento|consumidor|cliente|serie|s[ãa]o paulo|brasil/i.test(line)) return false
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(line)) return false
    const digits = (line.match(/\d/g) ?? []).length
    return digits <= Math.max(2, Math.floor(line.length * 0.2))
  }) ?? null
}

function inferAmount(text: string) {
  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const amountPattern = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+\.\d{2}/g
  const candidates: Array<{ cents: number; score: number }> = []

  for (const line of lines) {
    const matches = line.match(amountPattern) ?? []
    for (const token of matches) {
      const cents = toCents(token)
      if (cents == null) continue
      let score = 0
      if (/total|valor total|total a pagar|vl total|liquido|líquido|valor pago/i.test(line)) score += 6
      if (/troco|desconto|juros|taxa/i.test(line)) score -= 4
      score += Math.min(cents / 100000, 2)
      candidates.push({ cents, score })
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.cents - a.cents
  })

  return candidates[0]?.cents ?? null
}

function inferReceiptNumber(text: string) {
  const match = text.match(/(?:NFC-?e|NF-?e|CUPOM|DOC(?:UMENTO)?|COO|CCF|N[ÚU]MERO)\D{0,12}(\d{3,})/i)
  return match?.[1] ?? null
}

function inferTitle(vendorName: string | null) {
  if (!vendorName) return null
  return `Compra - ${vendorName}`
}

function toSafeCategory(value: unknown, fallback: ExpenseCategory) {
  if (typeof value !== 'string') return fallback
  return VALID_CATEGORIES.includes(value as ExpenseCategory) ? (value as ExpenseCategory) : fallback
}

function toSafeString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toSafeWarnings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 6)
}

function buildHeuristicSuggestion(ocrText: string): ExpenseClassificationSuggestion {
  const text = normalizeText(ocrText)
  const vendorName = inferVendor(text)
  const amountCents = inferAmount(text)
  const receiptNumber = inferReceiptNumber(text)
  const expenseDate = parseDate(text)
  const category = inferCategory(text)

  const warnings: string[] = []
  if (!amountCents) warnings.push('Valor total não identificado com confiança.')
  if (!vendorName) warnings.push('Fornecedor não identificado com confiança.')

  return {
    category,
    vendorName,
    amountCents,
    receiptNumber,
    expenseDate,
    title: inferTitle(vendorName),
    confidence: warnings.length === 0 ? 0.72 : 0.56,
    warnings,
  }
}

async function classifyWithAi(ocrText: string, baseline: ExpenseClassificationSuggestion) {
  const apiKey = process.env.EXPENSES_AI_API_KEY
  const model = process.env.EXPENSES_AI_MODEL ?? 'gpt-4o-mini'
  const apiUrl = process.env.EXPENSES_AI_API_URL ?? 'https://api.openai.com/v1/chat/completions'
  const enabled = (process.env.EXPENSES_AI_ENABLED ?? 'true').toLowerCase() !== 'false'
  const timeoutMs = Number(process.env.EXPENSES_AI_TIMEOUT_MS ?? '12000')

  if (!enabled) {
    return {
      suggestion: null,
      diagnostics: {
        attempted: false,
        usedAi: false,
        reason: 'disabled',
      } as ExpenseAiDiagnostics,
    }
  }

  if (!apiKey) {
    return {
      suggestion: null,
      diagnostics: {
        attempted: false,
        usedAi: false,
        reason: 'missing_api_key',
      } as ExpenseAiDiagnostics,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 12000)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Você classifica OCR de comprovante de obra no Brasil. Responda JSON estrito com: category (material|alimentacao|transporte|equipamento|servico|outros), vendorName, amountCents (inteiro em centavos), receiptNumber, expenseDate (YYYY-MM-DD), title, confidence (0-1), warnings (array).',
          },
          {
            role: 'user',
            content: JSON.stringify({
              ocrText: normalizeText(ocrText).slice(0, 6000),
              baseline,
              instruction: 'Use o baseline como referência quando houver ambiguidade.',
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      const normalized = raw.toLowerCase()
      let reason: ExpenseAiDiagnostics['reason'] = 'provider_error'

      if (response.status === 401 || response.status === 403 || /invalid[_\s-]?api[_\s-]?key|incorrect api key/.test(normalized)) {
        reason = 'invalid_api_key'
      } else if (response.status === 429 && /insufficient_quota|quota|billing|credit/.test(normalized)) {
        reason = 'insufficient_quota'
      } else if (response.status === 429) {
        reason = 'rate_limited'
      }

      return {
        suggestion: null,
        diagnostics: {
          attempted: true,
          usedAi: false,
          reason,
          statusCode: response.status,
          detail: raw.slice(0, 240),
        } as ExpenseAiDiagnostics,
      }
    }

    const payload = await response.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null

    const content = payload?.choices?.[0]?.message?.content
    if (!content) {
      return {
        suggestion: null,
        diagnostics: {
          attempted: true,
          usedAi: false,
          reason: 'invalid_response',
        } as ExpenseAiDiagnostics,
      }
    }

    const parsed = JSON.parse(content) as Record<string, unknown>

    const merged: ExpenseClassificationSuggestion = {
      category: toSafeCategory(parsed.category, baseline.category),
      vendorName: toSafeString(parsed.vendorName) ?? baseline.vendorName,
      amountCents: Number.isFinite(Number(parsed.amountCents)) ? Math.round(Number(parsed.amountCents)) : baseline.amountCents,
      receiptNumber: toSafeString(parsed.receiptNumber) ?? baseline.receiptNumber,
      expenseDate: toSafeString(parsed.expenseDate) ?? baseline.expenseDate,
      title: toSafeString(parsed.title) ?? baseline.title,
      confidence: clampConfidence(parsed.confidence, baseline.confidence),
      warnings: [...new Set([...baseline.warnings, ...toSafeWarnings(parsed.warnings)])],
    }

    return {
      suggestion: merged,
      diagnostics: {
        attempted: true,
        usedAi: true,
        reason: 'ok',
      } as ExpenseAiDiagnostics,
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    return {
      suggestion: null,
      diagnostics: {
        attempted: true,
        usedAi: false,
        reason: isTimeout ? 'timeout' : 'request_error',
        detail: error instanceof Error ? error.message.slice(0, 240) : undefined,
      } as ExpenseAiDiagnostics,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function classifyExpenseOcrText(ocrText: string) {
  const heuristic = buildHeuristicSuggestion(ocrText)
  const aiResult = await classifyWithAi(ocrText, heuristic)
  const aiSuggestion = aiResult.suggestion

  if (!aiSuggestion) {
    return {
      source: 'heuristic' as const,
      suggestion: heuristic,
      diagnostics: aiResult.diagnostics,
    }
  }

  return {
    source: 'ai' as const,
    suggestion: aiSuggestion,
    diagnostics: aiResult.diagnostics,
  }
}
