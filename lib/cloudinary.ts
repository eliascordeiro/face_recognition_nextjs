import { v2 as cloudinary } from 'cloudinary'

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  })
}

export function isCloudinaryConfigured() {
  return Boolean(cloudName && apiKey && apiSecret)
}

interface UploadedReceipt {
  secureUrl: string
  publicId: string
  format: string | null
  bytes: number | null
  width: number | null
  height: number | null
}

export async function uploadReceiptImage(params: {
  buffer: Buffer
  clientId: string
  originalFilename?: string | null
  mimeType?: string | null
}): Promise<UploadedReceipt> {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary não configurado')
  }

  const folder = `controle-de-obras/client-${params.clientId}/receipts`

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        overwrite: false,
        use_filename: true,
        unique_filename: true,
        filename_override: params.originalFilename ?? undefined,
        tags: ['receipt', 'expense'],
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Falha no upload do comprovante'))
          return
        }

        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id,
          format: result.format ?? null,
          bytes: typeof result.bytes === 'number' ? result.bytes : null,
          width: typeof result.width === 'number' ? result.width : null,
          height: typeof result.height === 'number' ? result.height : null,
        })
      }
    )

    stream.end(params.buffer)
  })
}

export async function deleteReceiptImage(publicId: string | null | undefined): Promise<void> {
  if (!publicId || !isCloudinaryConfigured()) return

  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  })
}