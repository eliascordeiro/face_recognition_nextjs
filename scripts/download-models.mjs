/**
 * Baixa os arquivos de pesos do face-api.js para public/models/.
 * Execute: npm run download-models
 *
 * Modelos necessários (~6 MB no total):
 *  - SSD MobileNet v1   → detecção de rostos
 *  - Face Landmark 68   → alinhamento do rosto
 *  - Face Recognition   → embedding 128-d
 */

import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'models')
const BASE_URL =
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/'

const MODEL_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'ssd_mobilenetv1_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
]

mkdirSync(OUTPUT_DIR, { recursive: true })

for (const file of MODEL_FILES) {
  const dest = path.join(OUTPUT_DIR, file)
  process.stdout.write(`⬇  ${file} … `)
  const res = await fetch(BASE_URL + file)
  if (!res.ok) {
    console.error(`FALHOU: ${res.status} ${res.statusText}`)
    process.exit(1)
  }
  await pipeline(res.body, createWriteStream(dest))
  console.log('✓')
}

console.log('\n✅ Todos os modelos baixados em public/models/')
