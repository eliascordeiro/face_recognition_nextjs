/**
 * Catálogo de capacidades granulares que um cliente pode liberar para um
 * operador. O papel "operator" continua existindo (compatibilidade), mas o
 * que ele pode fazer na prática é definido por essa lista de permissões,
 * armazenada em `users.permissions` (text[]) e embutida no JWT no login.
 *
 * "operators.manage" (gerenciar outros operadores) e "obras.manage"
 * (criar/editar/remover obras) nunca são liberáveis para operadores —
 * ficam restritos ao papel "client", evitando escalonamento de privilégio.
 */

export const OPERATOR_CAPABILITIES = [
  'employees.view',
  'employees.manage',
  'employees.face',
  'obras.view',
] as const

export type OperatorCapability = typeof OPERATOR_CAPABILITIES[number]

export const CAPABILITY_LABELS: Record<OperatorCapability, string> = {
  'employees.view': 'Ver lista de funcionários',
  'employees.manage': 'Cadastrar, editar e remover funcionários',
  'employees.face': 'Cadastrar/atualizar reconhecimento facial',
  'obras.view': 'Ver obras (somente leitura)',
}

export function isOperatorCapability(value: string): value is OperatorCapability {
  return (OPERATOR_CAPABILITIES as readonly string[]).includes(value)
}

/** Filtra e valida uma lista arbitrária, mantendo apenas capacidades conhecidas. */
export function sanitizePermissions(raw: unknown): OperatorCapability[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is OperatorCapability => typeof v === 'string' && isOperatorCapability(v))
}

/** Verifica se o usuário autenticado (via payload do JWT) tem a capacidade.
 *  Clients sempre têm acesso total às próprias funcionalidades; a checagem
 *  granular só se aplica a operadores. */
export function hasCapability(
  auth: { role: string; permissions?: string[] },
  capability: OperatorCapability
): boolean {
  if (auth.role === 'client') return true
  if (auth.role === 'operator') return (auth.permissions ?? []).includes(capability)
  return false
}
