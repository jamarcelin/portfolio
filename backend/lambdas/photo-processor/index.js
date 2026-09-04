'use strict'

// Step-dispatched photo processor for the portfolio pipeline.
// Invoked by Step Functions with: { step, bucket, prefix, album, bname, filename }
//
// Steps:
//   prepare  — parse S3 event key into { bucket, prefix, album, bname, filename }
//   resize   — generate thumb/medium/large derived sizes
//   colors   — compute CIELAB color palette → manifest.json colorMetadata
//   describe — Claude Haiku → 2-3 sentence description → manifest.json description
//   embed    — OpenAI text-embedding-3-large on description → embeddings.json

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime')
const { OpenAI } = require('openai')
const sharp = require('sharp')

const BUCKET  = process.env.BUCKET_NAME
const REGION  = process.env.AWS_ACCOUNT_REGION || 'us-east-1'
const MAX_EDGE = 1024
const COLOR_MAX_EDGE = 220

const CLAUDE_MODEL = 'us.anthropic.claude-3-haiku-20240307-v1:0'
const OPENAI_MODEL = 'text-embedding-3-large'

const s3      = new S3Client({ region: REGION })
const bedrock = new BedrockRuntimeClient({ region: REGION })
const _rawKey = process.env.OPENAI_API_KEY || ''
const openai  = new OpenAI({ apiKey: _rawKey.startsWith('{') ? Object.values(JSON.parse(_rawKey))[0] : _rawKey })

// ── Step handlers ─────────────────────────────────────────────────────────────

const STEP_HANDLERS = {
  prepare:  handlePrepare,
  resize:   handleResize,
  colors:   handleColors,
  describe: handleDescribe,
  embed:    handleEmbed,
}

exports.handler = async (event) => {
  const { step } = event
  const handler = STEP_HANDLERS[step]
  if (!handler) throw new Error(`Unknown step: ${step}`)
  console.log(`[${step}] starting for ${event.bname || event.key || '?'}`)
  const result = await handler(event)
  console.log(`[${step}] done:`, JSON.stringify(result))
  return result
}

// ── prepare: parse S3 event key ──────────────────────────────────────────────

async function handlePrepare(event) {
  const bucket = event.bucket || event.detail?.bucket?.name || BUCKET
  const key = event.key || event.detail?.object?.key || ''
  const decodedKey = decodeURIComponent(String(key).replace(/\+/g, ' '))
  const parsed = parseKey(decodedKey)
  if (!parsed) throw new Error(`Unexpected key structure: ${decodedKey}`)
  return {
    bucket,
    prefix: parsed.s3Prefix,
    album:  parsed.album,
    bname:  parsed.filename.replace(/\.[^./]+$/, ''),
    filename: parsed.filename,
  }
}

// ── resize: generate derived sizes ───────────────────────────────────────────

async function handleResize({ bucket, prefix, album, bname, filename }) {
  const origBuf = await downloadOriginal(bucket, prefix, album, filename)

  const p = prefix ? `${prefix}/` : ''
  await Promise.all([
    resizeAndUpload(origBuf, bucket, `${p}derived/thumb/${bname}.jpg`,  400,  400,  'cover'),
    resizeAndUpload(origBuf, bucket, `${p}derived/medium/${bname}.jpg`, 1200, null, 'inside'),
    resizeAndUpload(origBuf, bucket, `${p}derived/large/${bname}.jpg`,  2400, null, 'inside'),
  ])

  return { step: 'resize', bname, success: true }
}

// ── colors: compute CIELAB palette ───────────────────────────────────────────

async function handleColors({ bucket, prefix, album, bname, filename }) {
  const origBuf = await downloadOriginal(bucket, prefix, album, filename)
  const colorMetadata = await computeColorDescriptor(origBuf)
  const p = prefix ? `${prefix}/` : ''
  await upsertManifestField(bucket, p, bname, { colorMetadata })
  return { step: 'colors', bname, colorMetadata, success: true }
}

// ── describe: Claude Haiku → description ─────────────────────────────────────

async function handleDescribe({ bucket, prefix, album, bname, filename }) {
  const origBuf = await downloadOriginal(bucket, prefix, album, filename)

  const { data } = await sharp(origBuf)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true })

  const b64 = data.toString('base64')

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Describe this photograph in 2-3 sentences. Focus on the scene, light, mood, and composition.' },
      ],
    }],
  }

  const resp = await bedrock.send(new InvokeModelCommand({
    modelId:     CLAUDE_MODEL,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify(body),
  }))

  const result = JSON.parse(Buffer.from(resp.body).toString('utf8'))
  const description = result.content[0].text.trim()

  const p = prefix ? `${prefix}/` : ''
  await upsertManifestField(bucket, p, bname, { description })

  return { step: 'describe', bname, description, success: true }
}

// ── embed: OpenAI text-embedding-3-large on description ─────────────────────

async function handleEmbed({ bucket, prefix, album, bname }) {
  const p = prefix ? `${prefix}/` : ''

  const description    = await getManifestField(bucket, p, bname, 'description') || ''
  const collectionDesc = await getCollectionDescription(bucket, p, album)
  const textContext    = [description, collectionDesc].filter(Boolean).join('\n')

  if (!textContext) throw new Error(`No description found for ${bname} — run describe step first`)

  const resp = await openai.embeddings.create({ model: OPENAI_MODEL, input: textContext })
  const vector = resp.data[0].embedding

  await upsertEmbedding(bucket, p, { bname, album, textContext, vector })

  return { step: 'embed', bname, dims: vector.length, success: true }
}

// ── S3 helpers ───────────────────────────────────────────────────────────────

async function downloadOriginal(bucket, prefix, album, filename) {
  const p = prefix ? `${prefix}/` : ''
  const key = `${p}originals/${album}/${filename}`
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return streamToBuffer(resp.Body)
}

async function upsertManifestField(bucket, prefix, bname, fields) {
  const key = `${prefix}manifest.json`
  let manifest = []

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    manifest = JSON.parse(await streamToBuffer(resp.Body))
  } catch (err) {
    if (err.name !== 'NoSuchKey') console.warn('Could not read manifest.json:', err.message)
    return
  }

  if (!Array.isArray(manifest) || manifest.length === 0) return

  const idx = manifest.findIndex(photo => {
    const candidates = [photo.original, photo.medium, photo.large, photo.thumb, photo.src]
      .filter(Boolean).map(basenameOf)
    return candidates.includes(bname)
  })

  if (idx === -1) {
    console.warn('Manifest entry not found for bname:', bname)
    return
  }

  manifest[idx] = { ...manifest[idx], ...fields }

  await s3.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }))
}

async function getManifestField(bucket, prefix, bname, field) {
  const key = `${prefix}manifest.json`
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const manifest = JSON.parse(await streamToBuffer(resp.Body))
    const entry = manifest.find(photo => {
      const candidates = [photo.original, photo.medium, photo.large, photo.thumb, photo.src]
        .filter(Boolean).map(basenameOf)
      return candidates.includes(bname)
    })
    return entry?.[field] ?? null
  } catch {
    return null
  }
}

async function getCollectionDescription(bucket, prefix, album) {
  try {
    const resp = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: `${prefix}collections.json`,
    }))
    const collections = JSON.parse(await streamToBuffer(resp.Body))
    const col = collections.find(c => c.s3Album === album)
    return col?.description ?? ''
  } catch {
    return ''
  }
}

async function upsertEmbedding(bucket, prefix, { bname, album, textContext, vector }) {
  const key = `${prefix}private/embeddings.json`
  const MAX_RETRIES = 5

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let store = { version: 1, updatedAt: '', entries: [] }
    let etag  = null

    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      store = JSON.parse(await streamToBuffer(resp.Body))
      etag  = resp.ETag
    } catch (err) {
      if (err.name !== 'NoSuchKey') console.warn('Could not read embeddings.json:', err.message)
    }

    const idx   = store.entries.findIndex(e => e.bname === bname)
    const entry = { bname, album, textContext: textContext || '', embeddedAt: new Date().toISOString(), vector }
    if (idx >= 0) store.entries[idx] = entry
    else store.entries.push(entry)
    store.updatedAt = new Date().toISOString()

    try {
      await s3.send(new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        Body:        JSON.stringify(store),
        ContentType: 'application/json',
        ...(etag && { IfMatch: etag }),
      }))
      return // success
    } catch (err) {
      if (err.name === 'PreconditionFailed' && attempt < MAX_RETRIES - 1) {
        const delay = 200 * (attempt + 1)
        console.log(`embeddings.json write conflict for ${bname}, retrying in ${delay}ms (attempt ${attempt + 1})`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

// ── Resize + upload ──────────────────────────────────────────────────────────

async function resizeAndUpload(srcBuf, bucket, key, width, height, fit) {
  let pipe = sharp(srcBuf)

  pipe = height
    ? pipe.resize(width, height, { fit, position: 'attention', withoutEnlargement: true })
    : pipe.resize(width, null,   { fit: 'inside',              withoutEnlargement: true })

  const buf = await pipe
    .jpeg({ quality: 85, progressive: true })
    .toBuffer()

  await s3.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buf,
    ContentType: 'image/jpeg',
  }))

  console.log('  uploaded', key)
}

// ── Color metadata ───────────────────────────────────────────────────────────

async function computeColorDescriptor(origBuf) {
  const { data, info } = await sharp(origBuf)
    .resize(COLOR_MAX_EDGE, COLOR_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels
  const totalPixels = Math.floor(data.length / channels)
  const stride = totalPixels > 45000 ? 3 : 1

  let samples = 0
  let avgR = 0, avgG = 0, avgB = 0
  const buckets = new Map()

  for (let px = 0; px < totalPixels; px += stride) {
    const i = px * channels
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    avgR += r
    avgG += g
    avgB += b

    const qr = Math.floor(r / 32)
    const qg = Math.floor(g / 32)
    const qb = Math.floor(b / 32)
    const bkey = `${qr}-${qg}-${qb}`

    const bucket = buckets.get(bkey)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(bkey, { count: 1, r, g, b })
    }

    samples += 1
  }

  if (samples === 0) throw new Error('No usable pixels for color descriptor')

  const averageRgb = {
    r: clamp255(avgR / samples),
    g: clamp255(avgG / samples),
    b: clamp255(avgB / samples),
  }
  const averageLab = rgbToLab(averageRgb.r, averageRgb.g, averageRgb.b)

  const paletteTop = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const paletteWeightSum = paletteTop.reduce((sum, p) => sum + p.count, 0) || 1
  const palette = paletteTop.map((p) => {
    const rgb = {
      r: clamp255(p.r / p.count),
      g: clamp255(p.g / p.count),
      b: clamp255(p.b / p.count),
    }
    return {
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
      lab: rgbToLab(rgb.r, rgb.g, rgb.b),
      weight: p.count / paletteWeightSum,
    }
  })

  const dominant = palette[0] || {
    rgb: averageRgb,
    hsl: rgbToHsl(averageRgb.r, averageRgb.g, averageRgb.b),
    lab: averageLab,
    weight: 1,
  }

  return {
    version: 1,
    model: {
      space: 'CIELAB',
      distance: 'CIEDE2000',
      descriptor: 'top-5 weighted palette',
    },
    sampleCount: samples,
    average: {
      rgb: averageRgb,
      hsl: rgbToHsl(averageRgb.r, averageRgb.g, averageRgb.b),
      lab: averageLab,
    },
    dominant: {
      rgb: dominant.rgb,
      hsl: dominant.hsl,
      lab: dominant.lab,
    },
    palette: palette.map((p) => ({
      rgb: p.rgb,
      hsl: p.hsl,
      lab: p.lab,
      weight: Number(p.weight.toFixed(6)),
    })),
  }
}

// ── Utility helpers ──────────────────────────────────────────────────────────

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}


function basenameOf(urlOrKey) {
  const noQuery = String(urlOrKey || '').split('?')[0]
  const part = noQuery.split('/').pop() || ''
  return part.replace(/\.[^.]+$/, '')
}

function parseKey(key) {
  const parts = key.split('/')
  const originalsIdx = parts.findIndex(p => p === 'originals')
  if (originalsIdx === -1 || parts.length < originalsIdx + 3) return null
  return {
    s3Prefix: parts.slice(0, originalsIdx).join('/') || '',
    album:    parts[originalsIdx + 1],
    filename: parts.slice(originalsIdx + 2).join('/'),
  }
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min, l = (max + min) / 2
  let h = 0, s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function srgbToLinear(v) {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) * 100
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) * 100
  const f = (t) => (t > 0.008856 ? t ** (1 / 3) : (7.787 * t) + (16 / 116))
  const fx = f(x / 95.047), fy = f(y / 100.0), fz = f(z / 108.883)
  return {
    L: Number(((116 * fy) - 16).toFixed(4)),
    a: Number((500 * (fx - fy)).toFixed(4)),
    b: Number((200 * (fy - fz)).toFixed(4)),
  }
}
