import type { PoolClient } from 'pg'

type ExpenseAuditAction = 'create' | 'update' | 'delete'

interface ExpenseAuditParams {
  client: PoolClient
  expenseId: number
  clientId: number
  actorUserId: number
  action: ExpenseAuditAction
  beforeState?: unknown
  afterState?: unknown
}

function normalizeState(value: unknown) {
  return value == null ? null : JSON.stringify(value)
}

export async function logExpenseAudit(params: ExpenseAuditParams) {
  await params.client.query(
    `INSERT INTO construction_expense_audit (
       expense_id, client_id, actor_user_id, action, before_state, after_state
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      params.expenseId,
      params.clientId,
      params.actorUserId,
      params.action,
      normalizeState(params.beforeState),
      normalizeState(params.afterState),
    ]
  )
}