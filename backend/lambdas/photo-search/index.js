'use strict'

// Photo search Lambda — exposed via Function URL
//
// POST /
// Body: { "prompt": "string", "limit": 10, "collectionId": "optional" }
//
// 1. Embeds the prompt text via OpenAI text-embedding-3-large
// 2. Loads private/embeddings.json from S3
// 3. Optionally filters by collectionId
// 4. Ranks by cosine similarity
// 5. Joins top-N bnames to manifest.json entries and returns them

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
const { OpenAI } = require('openai')

const BUCKET = process.env.BUCKET_NAME
const PREFIX = process.env.S3_PREFIX || 'bin'
const REGION = process.env.AWS_REGION || 'us-east-1'

const s3     = new S3Client({ region: REGION })
const _rawKey = process.env.OPENAI_API_KEY || ''
const openai  = new OpenAI({ apiKey: _rawKey.startsWith('{') ? Object.values(JSON.parse(_rawKey))[0] : _rawKey })

// Module-level cache — reused across warm invocations, TTL 5 minutes
let _manifest      = null
let _embeddings    = null
let _manifestAt    = 0
let _embeddingsAt  = 0
const CACHE_TTL_MS = 5 * 60 * 1000

exports.handler = async (event) => {
  // ── Parse body ─────────────────────────────────────────────────────────────
  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return response(400, { error: 'Invalid JSON body' })
  }

  const prompt      = (body.prompt || '').trim()
  const limit       = Math.min(Math.max(parseInt(body.limit) || 10, 1), 50)
  const collectionId = body.collectionId || null

  if (!prompt) return response(400, { error: 'prompt is required' })
  if (prompt.length > 500) return response(400, { error: 'prompt must be 500 characters or less' })

  try {
    // ── Embed the prompt ────────────────────────────────────────────────────
    const queryVector = await embedText(prompt)

    // ── Load data (cached) ──────────────────────────────────────────────────
    const [manifest, embeddings] = await Promise.all([
      getManifest(),
      getEmbeddings(),
    ])

    // ── Filter + rank ───────────────────────────────────────────────────────
    let entries = embeddings.entries || []
    if (collectionId) {
      // Find the s3Album for this collectionId via manifest entries
      const albumForCollection = manifest.find(p => p.collectionId === collectionId)?.album
      if (albumForCollection) entries = entries.filter(e => e.album === albumForCollection)
    }

    const scored = entries
      .map(e => ({ bname: e.bname, score: cosineSimilarity(queryVector, e.vector) }))
      .filter(e => e.score > 0.1)
    scored.sort((a, b) => b.score - a.score)

    // ── Join to manifest ────────────────────────────────────────────────────
    const topBnames = new Set(scored.slice(0, limit).map(s => s.bname))
    const scoreMap  = Object.fromEntries(scored.map(s => [s.bname, s.score]))

    const results = manifest
      .filter(p => {
        const bname = basenameOf(p.original || p.src || '')
        return topBnames.has(bname)
      })
      .map(p => ({
        ...p,
        _score: scoreMap[basenameOf(p.original || p.src || '')] ?? 0,
      }))
      .sort((a, b) => b._score - a._score)

    return response(200, {
      results,
      query:         prompt,
      totalScored:   entries.length,
      returnedCount: results.length,
    })
  } catch (err) {
    console.error('Search error:', err)
    return response(500, { error: 'Internal error — please try again' })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function embedText(text) {
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-large', input: text })
  return resp.data[0].embedding
}

async function getManifest() {
  if (_manifest && Date.now() - _manifestAt < CACHE_TTL_MS) return _manifest
  const key = `${PREFIX}/manifest.json`
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  _manifest   = JSON.parse(await streamToString(resp.Body))
  _manifestAt = Date.now()
  return _manifest
}

async function getEmbeddings() {
  if (_embeddings && Date.now() - _embeddingsAt < CACHE_TTL_MS) return _embeddings
  const key = `${PREFIX}/private/embeddings.json`
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  _embeddings   = JSON.parse(await streamToString(resp.Body))
  _embeddingsAt = Date.now()
  return _embeddings
}

async function streamToString(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0
}

// Extract basename without extension from a URL or S3 key
function basenameOf(urlOrKey) {
  const part = urlOrKey.split('/').pop() || ''
  return part.replace(/\.[^.]+$/, '')
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
