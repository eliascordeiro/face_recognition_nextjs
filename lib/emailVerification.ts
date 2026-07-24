import { randomInt } from 'crypto'
import { sendMail } from '@/lib/email'
import { sha256 } from '@/lib/security'

export const EMAIL_VERIFICATION_CODE_LENGTH = 4
export const EMAIL_VERIFICATION_EXPIRES_MINUTES = 10
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60

export function createEmailVerificationCode(): string {
  const max = 10 ** EMAIL_VERIFICATION_CODE_LENGTH
  return String(randomInt(0, max)).padStart(EMAIL_VERIFICATION_CODE_LENGTH, '0')
}

export function createEmailVerificationCodeHash(code: string): string {
  return sha256(code)
}

export async function sendEmailVerificationCode(params: {
  to: string
  recipientName?: string | null
  code: string
}): Promise<void> {
  const recipientName = params.recipientName || 'usuário'
  await sendMail({
    to: params.to,
    subject: 'Código de verificação - Obras',
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.4;color:#0f172a;max-width:560px">
        <h2 style="margin-bottom:8px">Verificação de e-mail</h2>
        <p>Olá, ${recipientName}.</p>
        <p>Use o código abaixo para concluir a criação da sua conta no Obras:</p>
        <div style="margin:18px 0;padding:14px 18px;border:1px solid #cbd5e1;border-radius:10px;display:inline-block;font-size:28px;letter-spacing:6px;font-weight:700">
          ${params.code}
        </div>
        <p>Este código expira em ${EMAIL_VERIFICATION_EXPIRES_MINUTES} minutos.</p>
        <p>Se você não solicitou este cadastro, pode ignorar este e-mail.</p>
      </div>
    `,
  })
}
