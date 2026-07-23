/**
 * Catálogo de capacidades granulares que um cliente pode liberar para um
 * operador. O papel "operator" continua existindo (compatibilidade), mas o
 * que ele pode fazer na prática é definido por essa lista de permissões,
 * armazenada em `users.permissions` (text[]) e embutida no JWT no login.
 *
 * "operators.manage" (gerenciar outros operadores) continua restrita ao
 * papel "client". As demais capacidades podem ser liberadas de forma
 * granular para o operador.
 */

export const OPERATOR_CAPABILITIES = [
  'employees.view',
  'employees.manage',
  'employees.face',
  'obras.view',
  'obras.manage',
] as const

export type OperatorCapability = typeof OPERATOR_CAPABILITIES[number]

export const CAPABILITY_LABELS: Record<OperatorCapability, string> = {
  'employees.view': 'Ver lista de funcionários',
  'employees.manage': 'Cadastrar, editar e remover funcionários',
  'employees.face': 'Cadastrar/atualizar reconhecimento facial',
  'obras.view': 'Ver obras (somente leitura)',
  'obras.manage': 'Cadastrar, editar e remover obras',
}

export function isOperatorCapability(value: string): value is OperatorCapability {
  return (OPERATOR_CAPABILITIES as readonly string[]).includes(value)
}

/**
 * Regras de heranca de permissao para evitar combinacoes incoerentes.
 * Ex.: quem gerencia funcionarios tambem precisa conseguir visualizar lista.
 */
function withImpliedCapabilities(input: OperatorCapability[]): OperatorCapability[] {
  const granted = new Set<OperatorCapability>(input)

  if (granted.has('employees.manage') || granted.has('employees.face')) {
    granted.add('employees.view')
  }
  if (granted.has('obras.manage')) {
    granted.add('obras.view')
  }

  return Array.from(granted)
}

/** Filtra e valida uma lista arbitrária, mantendo apenas capacidades conhecidas. */
export function sanitizePermissions(raw: unknown): OperatorCapability[] {
  if (!Array.isArray(raw)) return []
  const filtered = raw.filter((v): v is OperatorCapability => typeof v === 'string' && isOperatorCapability(v))
  return withImpliedCapabilities(filtered)
}

/** Verifica se o usuário autenticado (via payload do JWT) tem a capacidade.
 *  Clients sempre têm acesso total às próprias funcionalidades; a checagem
 *  granular só se aplica a operadores. */
export function hasCapability(
  auth: { role: string; permissions?: string[] },
  capability: OperatorCapability
): boolean {
  if (auth.role === 'client') return true
  if (auth.role === 'operator') {
    const normalized = sanitizePermissions(auth.permissions ?? [])
    return normalized.includes(capability)
  }
  return false
}
