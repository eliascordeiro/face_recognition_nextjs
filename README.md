# Face Recognition — Next.js + face-api.js + PostgreSQL/pgvector

Reconhecimento facial com câmera do PC ou smartphone, rodando inteiramente no Railway  
em **um único serviço** + addon PostgreSQL.

## Por que essa arquitetura?

| | Versão anterior (Python/FastAPI) | Esta versão (Next.js) |
|---|---|---|
| **Serviços no Railway** | 2 (backend + nginx) | **1** |
| **Cold start** | Lento (DeepFace baixa ~300 MB) | **Rápido** (modelos no build) |
| **HTTPS automático** | Manual | **Sim** (câmera do smartphone funciona) |
| **Imagem Docker** | ~2-3 GB | **~300 MB** |
| **ML** | Servidor (Python) | **Cliente** (JS no browser) |

> O embedding de 128 dimensões é extraído **no dispositivo do usuário** pelo face-api.js.  
> O servidor Next.js só faz operações no banco (salvar/buscar vetores).

## Estrutura

```
face_recognition_nextjs/
├── railway.toml                  ← build + deploy config
├── scripts/
│   └── download-models.mjs       ← baixa pesos do face-api.js (~6 MB)
├── lib/
│   └── db.ts                     ← pool PostgreSQL + auto-init pgvector
├── app/
│   ├── page.tsx                  ← UI: câmera WebRTC + 3 abas (React Client)
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── persons/route.ts      ← GET (listar) + POST (cadastrar)
│       ├── persons/[id]/route.ts ← DELETE
│       ├── recognize/route.ts    ← POST (busca pgvector)
│       └── health/route.ts       ← health check
└── public/
    └── models/                   ← pesos do face-api.js (gerado pelo download)
```

## Deploy no Railway (passo a passo)

### 1. Criar projeto no Railway

```bash
# Instale a CLI do Railway
npm i -g @railway/cli
railway login
railway init
```

### 2. Adicionar PostgreSQL

No dashboard Railway: **+ New** → **Database** → **PostgreSQL**.  
A variável `DATABASE_URL` é injetada automaticamente no serviço.  
O schema (tabela + índice pgvector) é criado **automaticamente** na primeira requisição.

### 3. Deploy

```bash
railway up
```

O `railway.toml` garante que os modelos são baixados durante o build:
```
npm ci → download-models → next build
```

### 4. Acesso

- URL gerada pelo Railway (ex: `https://face-xxx.railway.app`)
- HTTPS automático → câmera do smartphone funciona sem configuração extra

---

## Desenvolvimento local

```bash
# 1. Instalar dependências
npm install

# 2. Baixar modelos do face-api.js (~6 MB)
npm run download-models

# 3. Copiar variáveis de ambiente
cp .env.example .env.local
# edite .env.local com sua URL do Postgres local

# 4. Subir banco local (opcional, com Docker)
docker run -d --name pgvector \
  -e POSTGRES_PASSWORD=pass \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# 5. Rodar em modo desenvolvimento
npm run dev
# Acesse: http://localhost:3000
```

## Fluxo de uso

1. **Cadastro**: Ligue a câmera → Capture o rosto → Informe o nome → Salvar cadastro  
2. **Reconhecimento**: Ligue a câmera → Capture → Identificar agora

## Limiar de reconhecimento

O arquivo [app/api/recognize/route.ts](app/api/recognize/route.ts) define:
```ts
const MATCH_THRESHOLD = 0.6  // distância L2 máxima (0 = idêntico, 2 = máximo)
```
Ajuste conforme necessário (menor = mais restritivo).
