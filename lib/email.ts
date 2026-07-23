const RESEND_API_URL = 'https://api.resend.com/emails'

export interface MailPayload {
  to: string
  subject: string
  html: string
}

/** Envia e-mail transacional usando a API HTTP da Resend. */
export async function sendMail({ to, subject, html }: MailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM

  if (!apiKey || !from) {
    throw new Error('Variáveis de e-mail não configuradas (RESEND_API_KEY e SMTP_FROM ou EMAIL_FROM)')
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Falha ao enviar e-mail (${res.status}): ${body}`)
  }
}
