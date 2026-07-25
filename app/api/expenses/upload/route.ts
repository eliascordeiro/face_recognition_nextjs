import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isCloudinaryConfigured, uploadReceiptImage } from '@/lib/cloudinary'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }
    if (!isCloudinaryConfigured()) {
      return NextResponse.json({ error: 'Storage de comprovantes não configurado' }, { status: 503 })
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo do comprovante é obrigatório' }, { status: 422 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Envie uma imagem válida do comprovante' }, { status: 422 })
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'A imagem deve ter até 8MB' }, { status: 422 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const uploaded = await uploadReceiptImage({
      buffer,
      clientId: auth.sub,
      originalFilename: file.name,
      mimeType: file.type,
    })

    return NextResponse.json({
      url: uploaded.secureUrl,
      publicId: uploaded.publicId,
      format: uploaded.format,
      bytes: uploaded.bytes,
      width: uploaded.width,
      height: uploaded.height,
    }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Falha ao enviar comprovante' }, { status: 500 })
  }
}