require('dotenv').config()
const express = require('express')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const sharp = require('sharp')

const THUMB_DIR = path.join(os.tmpdir(), 'portfolio-admin-thumbs')
fs.mkdirSync(THUMB_DIR, { recursive: true })

const PLAYGROUND_DIR  = path.join(__dirname, '..', 'playground')
const COMPARE_PY      = path.join(PLAYGROUND_DIR, 'compare.py')
const INDICES_DIR     = path.join(PLAYGROUND_DIR, 'cache', 'indices')
const CACHE_IMAGE_DIR = path.join(PLAYGROUND_DIR, 'cache', 'images')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))
// Serve playground thumbnail cache so the search lab can show images
app.use('/api/cache-images', express.static(CACHE_IMAGE_DIR))

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.tiff', '.avif'])

const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'manifest.json')
const DEFAULT_TAGS = ['landscape', 'portrait', 'architecture', 'street', 'nature', 'travel', 'event', 'other']

function readManifest() {
  try {
    if (fs.existsSync(MANIFEST_PATH)) return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {}
  return { tags: [...DEFAULT_TAGS] }
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

function photoBname(photo) {
  const url = photo?.original || photo?.src || ''
  const part = String(url).split('/').pop() || ''
  return part.replace(/\.[^.]+$/, '')
}

function photoFilename(photo) {
  const url = photo?.original || photo?.src || ''
  return String(url).split('/').pop() || ''
}

function getS3RuntimeConfig(input = {}) {
  return {
    bucket: input.bucket || process.env.S3_BUCKET || 'joshs-photo-storage',
    prefix: input.prefix ?? process.env.S3_PREFIX ?? '',
    region: input.region || process.env.AWS_REGION || 'us-east-1',
  }
}

function createS3Client(region) {
  const { S3Client } = require('@aws-sdk/client-s3')
  return new S3Client({
    region,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })
}

async function readJsonFromS3({ bucket, prefix, region, filename }) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  const s3 = createS3Client(region)
  const key = prefix ? `${prefix}/${filename}` : filename

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const chunks = []
    for await (const chunk of resp.Body) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (err) {
    if (err.name === 'NoSuchKey') return null
    throw err
  }
}

async function loadPipelineManifest(config) {
  return await readJsonFromS3({ ...config, filename: 'manifest.json' }) || []
}

async function findPipelinePhoto(config, bname) {
  const manifest = await loadPipelineManifest(config)
  return manifest.find(photo => photoBname(photo) === bname) || null
}

// Initialise manifest.json if it doesn't exist
if (!fs.existsSync(MANIFEST_PATH)) writeManifest(readManifest())

// ── Tags (manifest.json) ─────────────────────────────────────────────────────
app.get('/api/tags', (req, res) => {
  res.json(readManifest().tags)
})

app.post('/api/tags', (req, res) => {
  const raw = (req.body.tag || '').trim()
  if (!raw) return res.status(400).json({ error: 'tag required' })

  // Normalise: lowercase, spaces → hyphens, strip non-alphanum/hyphen
  const tag = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!tag) return res.status(400).json({ error: 'Invalid tag name' })

  const manifest = readManifest()
  if (!manifest.tags.includes(tag)) {
    manifest.tags.push(tag)
    writeManifest(manifest)
  }

  res.json({ tag, tags: manifest.tags })
})

app.delete('/api/tags/:tag', (req, res) => {
  const manifest = readManifest()
  manifest.tags = manifest.tags.filter(t => t !== req.params.tag)
  writeManifest(manifest)
  res.json({ tags: manifest.tags })
})
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
}

// ── List images in a directory ───────────────────────────────────────────────
app.get('/api/photos', (req, res) => {
  const { dir } = req.query
  if (!dir) return res.status(400).json({ error: 'dir param required' })

  try {
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' })

    const files = fs.readdirSync(dir, { withFileTypes: true })
    const images = files
      .filter(f => f.isFile() && IMAGE_EXTS.has(path.extname(f.name).toLowerCase()))
      .map(f => ({
        name: f.name,
        filepath: path.join(dir, f.name),
        size: fs.statSync(path.join(dir, f.name)).size,
      }))

    res.json({ images, count: images.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Serve a local image for preview (with optional thumbnail) ────────────────
app.get('/api/preview', async (req, res) => {
  const { filepath, thumb, fit } = req.query
  if (!filepath) return res.status(400).send('filepath param required')

  const resolved = path.resolve(filepath)
  if (!fs.existsSync(resolved)) return res.status(404).send('File not found')

  if (!thumb) return res.sendFile(resolved)

  // Serve a cached 400px thumbnail
  const mode = fit === 'inside' ? 'inside' : 'cover'
  const hash = crypto.createHash('md5').update(`${resolved}:${mode}`).digest('hex')
  const thumbPath = path.join(THUMB_DIR, hash + '.jpg')

  try {
    if (!fs.existsSync(thumbPath)) {
      const pipeline = sharp(resolved)
      if (mode === 'inside') {
        await pipeline
          .resize(420, 420, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 78, progressive: true })
          .toFile(thumbPath)
      } else {
        await pipeline
          .resize(400, 400, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 75, progressive: true })
          .toFile(thumbPath)
      }
    }
    res.set('Cache-Control', 'private, max-age=86400')
    res.sendFile(thumbPath)
  } catch {
    // Fallback to original if sharp can't handle the format (e.g. some HEIC)
    res.sendFile(resolved)
  }
})

// ── Rename files on disk ─────────────────────────────────────────────────────
app.post('/api/rename', (req, res) => {
  const { renames } = req.body
  if (!Array.isArray(renames)) return res.status(400).json({ error: 'renames must be an array' })

  const results = []

  for (const { oldPath, newName } of renames) {
    const dir = path.dirname(oldPath)
    const newPath = path.join(dir, newName)

    if (newPath === oldPath) {
      results.push({ oldPath, newPath, newName, success: true, skipped: true })
      continue
    }

    if (fs.existsSync(newPath)) {
      results.push({ oldPath, newName, success: false, error: `"${newName}" already exists` })
      continue
    }

    try {
      fs.renameSync(oldPath, newPath)
      results.push({ oldPath, newPath, newName, success: true })
    } catch (err) {
      results.push({ oldPath, newName, success: false, error: err.message })
    }
  }

  res.json({ results })
})

// ── Rotate an image in place on disk ─────────────────────────────────────────
app.post('/api/rotate', async (req, res) => {
  const { filepath, degrees } = req.body
  if (!filepath) return res.status(400).json({ error: 'filepath required' })
  if (![90, 180, 270].includes(Number(degrees))) return res.status(400).json({ error: 'degrees must be 90, 180, or 270' })

  const resolved = path.resolve(filepath)
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' })

  try {
    const buf = await sharp(resolved).rotate(Number(degrees)).toBuffer()
    fs.writeFileSync(resolved, buf)

    // Clear thumbnail cache so the next preview reflects the rotation
    const hash = crypto.createHash('md5').update(resolved).digest('hex')
    const thumbPath = path.join(THUMB_DIR, hash + '.jpg')
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Upsert a collection entry in S3 collections.json ─────────────────────────
app.post('/api/collections', async (req, res) => {
  const { collectionName, collectionDescription, s3Album, bucket, prefix, region } = req.body
  if (!collectionName) return res.status(400).json({ error: 'collectionName required' })

  const awsBucket = bucket || process.env.S3_BUCKET
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  if (!awsBucket) return res.status(400).json({ error: 'S3 bucket not configured' })

  let S3Client, GetObjectCommand, PutObjectCommand
  try {
    ;({ S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found — run npm install' })
  }

  const id = collectionName.toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
  })

  const base = prefix || ''
  const collectionsKey = base ? `${base}/collections.json` : 'collections.json'

  let collections = []
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: collectionsKey }))
    const chunks = []
    for await (const chunk of resp.Body) chunks.push(chunk)
    collections = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (err) {
    if (err.name !== 'NoSuchKey') console.warn('Could not read collections.json:', err.message)
  }

  const existingIdx = collections.findIndex(c => c.id === id)
  const now = new Date().toISOString()
  const entry = {
    id,
    name: collectionName,
    description: collectionDescription || '',
    s3Album: s3Album || id,
    createdAt: existingIdx >= 0 ? collections[existingIdx].createdAt : now,
    updatedAt: now,
  }

  if (existingIdx >= 0) collections[existingIdx] = { ...collections[existingIdx], ...entry }
  else collections.push(entry)

  await s3.send(new PutObjectCommand({
    Bucket:      awsBucket,
    Key:         collectionsKey,
    Body:        JSON.stringify(collections, null, 2),
    ContentType: 'application/json',
  }))

  res.json({ success: true, collection: entry })
})

// ── Upload a single photo to S3 ──────────────────────────────────────────────
// Uploads the original only. Lambda handles derived size generation.
// Structure:
//   {prefix}/originals/{album}/{filename}   — original (triggers Lambda via SQS)
//   {prefix}/derived/thumb/{base}.jpg       — generated by Lambda (400×400)
//   {prefix}/derived/medium/{base}.jpg      — generated by Lambda (1200px wide)
//   {prefix}/derived/large/{base}.jpg       — generated by Lambda (2400px wide)
app.post('/api/upload', async (req, res) => {
  const { filepath, bucket, prefix, region, album, albumName, collectionId, title, tags, description: caption } = req.body

  if (!filepath) return res.status(400).json({ error: 'filepath required' })

  const awsBucket = bucket || process.env.S3_BUCKET
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  if (!awsBucket) return res.status(400).json({ error: 'S3 bucket not configured' })

  let S3Client, PutObjectCommand, GetObjectCommand
  try {
    ;({ S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found — run npm install' })
  }

  const resolved = path.resolve(filepath)
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found on disk' })

  const fname  = path.basename(resolved)
  const bname  = path.basename(fname, path.extname(fname))
  const ext    = path.extname(fname).toLowerCase()
  const base   = prefix || ''
  const keyOf  = sub => base ? `${base}/${sub}` : sub
  const urlOf  = key => `https://${awsBucket}.s3.${awsRegion}.amazonaws.com/${key}`

  const effectiveAlbum = album || 'misc'
  const keys = {
    original: keyOf(`originals/${effectiveAlbum}/${fname}`),
    thumb:    keyOf(`derived/thumb/${bname}.jpg`),
    medium:   keyOf(`derived/medium/${bname}.jpg`),
    large:    keyOf(`derived/large/${bname}.jpg`),
  }

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
  })

  try {
    // ── Read EXIF ─────────────────────────────────────────────────────────
    let camera = null, timestamp = null
    try {
      const { default: exifr } = await import('exifr')
      const exif = await exifr.parse(resolved, ['Make', 'Model', 'DateTimeOriginal', 'CreateDate'])
      if (exif) {
        const make  = exif.Make?.trim() ?? ''
        const model = exif.Model?.trim() ?? ''
        if (make && model) {
          camera = model.startsWith(make) ? model : `${make} ${model}`
        } else {
          camera = make || model || null
        }
        const dt = exif.DateTimeOriginal || exif.CreateDate
        if (dt instanceof Date) timestamp = dt.toISOString()
        else if (typeof dt === 'string') timestamp = new Date(dt).toISOString()
      }
    } catch { /* EXIF unavailable — continue without it */ }

    // ── Upload original (Lambda will generate derived sizes via SQS) ──────
    const origBuf = fs.readFileSync(resolved)
    await s3.send(new PutObjectCommand({
      Bucket: awsBucket,
      Key: keys.original,
      Body: origBuf,
      ContentType: CONTENT_TYPES[ext] || 'image/jpeg',
      Metadata: {
        ...(title        && { title }),
        ...(tags?.length  && { tags: tags.join(',') }),
        ...(caption      && { caption }),
        ...(camera       && { camera }),
        ...(timestamp    && { timestamp }),
      },
    }))

    // Pre-compute derived URLs — Lambda will write the actual files
    const thumbUrl  = urlOf(keys.thumb)
    const mediumUrl = urlOf(keys.medium)
    const largeUrl  = urlOf(keys.large)

    // Build tag list — include albumName as a tag if provided
    const photoTags = Array.isArray(tags) ? [...tags] : []
    if (albumName && !photoTags.includes(albumName)) photoTags.push(albumName)

    const entry = {
      id:          Date.now() + Math.floor(Math.random() * 1000),
      title:       title || '',
      tags:        photoTags,
      caption:     caption || '',
      ...(albumName    && { albumName }),
      ...(collectionId && { collectionId }),
      album: effectiveAlbum,
      ...(camera    && { camera }),
      ...(timestamp && { timestamp }),
      src:      mediumUrl,
      original: urlOf(keys.original),
      thumb:    thumbUrl,
      medium:   mediumUrl,
      large:    largeUrl,
      s3Prefix: base,
    }

    // ── Read S3 manifest, append entry, write back ────────────────────────
    const manifestKey = keyOf('manifest.json')
    let manifest = []
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: manifestKey }))
      const chunks = []
      for await (const chunk of resp.Body) chunks.push(chunk)
      manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      if (err.name !== 'NoSuchKey') console.warn('Could not read S3 manifest:', err.message)
    }

    manifest.push(entry)
    await s3.send(new PutObjectCommand({
      Bucket:      awsBucket,
      Key:         manifestKey,
      Body:        JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }))

    // ── Keep local photos.json in sync (used by admin library view) ───────
    const photosJsonPath = path.join(__dirname, '..', 'data', 'photos.json')
    try {
      fs.mkdirSync(path.dirname(photosJsonPath), { recursive: true })
      fs.writeFileSync(photosJsonPath, JSON.stringify(manifest, null, 2))
    } catch (e) { console.warn('photos.json write error:', e.message) }

    // ── Update local manifest cameras list ────────────────────────────────
    if (camera) {
      const localManifest = readManifest()
      if (!localManifest.cameras) localManifest.cameras = []
      if (!localManifest.cameras.includes(camera)) {
        localManifest.cameras.push(camera)
        writeManifest(localManifest)
      }
    }

    res.json({ success: true, entry })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── Get photos.json (library) ────────────────────────────────────────────────
app.get('/api/library', (req, res) => {
  const photosJsonPath = path.join(__dirname, '..', 'data', 'photos.json')
  try {
    const photos = fs.existsSync(photosJsonPath)
      ? JSON.parse(fs.readFileSync(photosJsonPath, 'utf8'))
      : []
    res.json(photos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Delete a photo from photos.json ─────────────────────────────────────────
app.delete('/api/library/:id', (req, res) => {
  const photosJsonPath = path.join(__dirname, '..', 'data', 'photos.json')
  try {
    let photos = fs.existsSync(photosJsonPath)
      ? JSON.parse(fs.readFileSync(photosJsonPath, 'utf8'))
      : []
    photos = photos.filter(p => String(p.id) !== req.params.id)
    fs.writeFileSync(photosJsonPath, JSON.stringify(photos, null, 2))
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Update a photo entry in photos.json ──────────────────────────────────────
app.patch('/api/library/:id', (req, res) => {
  const photosJsonPath = path.join(__dirname, '..', 'data', 'photos.json')
  try {
    let photos = fs.existsSync(photosJsonPath)
      ? JSON.parse(fs.readFileSync(photosJsonPath, 'utf8'))
      : []
    const idx = photos.findIndex(p => String(p.id) === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Photo not found' })
    photos[idx] = { ...photos[idx], ...req.body }
    fs.writeFileSync(photosJsonPath, JSON.stringify(photos, null, 2))
    res.json({ success: true, photo: photos[idx] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Embeddings viewer ─────────────────────────────────────────────────────────
app.get('/api/embeddings', async (req, res) => {
  const { bucket, prefix, region } = req.query
  const awsBucket = bucket || process.env.S3_BUCKET
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  if (!awsBucket) return res.status(400).json({ error: 'S3 bucket not configured' })

  let S3Client, GetObjectCommand
  try {
    ;({ S3Client, GetObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found' })
  }

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })

  const base = prefix || ''
  const read = async (key) => {
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: key }))
      const chunks = []
      for await (const chunk of resp.Body) chunks.push(chunk)
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      if (err.name !== 'NoSuchKey') console.warn(`Could not read ${key}:`, err.message)
      return null
    }
  }

  const embKey      = base ? `${base}/private/embeddings.json` : 'private/embeddings.json'
  const manifestKey = base ? `${base}/manifest.json`           : 'manifest.json'

  const [store, manifest] = await Promise.all([read(embKey), read(manifestKey)])
  if (!store) return res.status(404).json({ error: 'embeddings.json not found' })

  const manifestByBname = {}
  for (const p of (manifest || [])) {
    const url = p.original || p.src || ''
    const part = url.split('/').pop() || ''
    const bn = part.replace(/\.[^.]+$/, '')
    if (bn) manifestByBname[bn] = p
  }

  const entries = (store.entries || []).map(e => {
    const mp = manifestByBname[e.bname] || {}
    return {
      bname:       e.bname,
      album:       e.album,
      textContext: e.textContext ?? null,
      embeddedAt:  e.embeddedAt ?? null,
      thumb:       mp.thumb || null,
      albumName:   mp.albumName || null,
      inManifest:  !!mp.id,
    }
  })

  res.json({ entries, updatedAt: store.updatedAt })
})

app.delete('/api/embeddings/bulk', async (req, res) => {
  const { bnames, all } = req.body || {}
  const { bucket, prefix, region } = req.query
  const awsBucket = bucket || process.env.S3_BUCKET
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  if (!awsBucket) return res.status(400).json({ error: 'S3 bucket not configured' })
  if (!all && (!Array.isArray(bnames) || bnames.length === 0)) return res.status(400).json({ error: 'bnames array or all:true required' })

  let S3Client, GetObjectCommand, PutObjectCommand
  try {
    ;({ S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found' })
  }

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })

  const base   = prefix || ''
  const embKey = base ? `${base}/private/embeddings.json` : 'private/embeddings.json'

  try {
    let store = null
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: embKey }))
      const chunks = []
      for await (const chunk of resp.Body) chunks.push(chunk)
      store = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      if (err.name !== 'NoSuchKey') throw err
    }

    if (store) {
      store.entries = all ? [] : (store.entries || []).filter(e => !bnames.includes(e.bname))
      store.updatedAt = new Date().toISOString()
      await s3.send(new PutObjectCommand({ Bucket: awsBucket, Key: embKey, Body: JSON.stringify(store, null, 2), ContentType: 'application/json' }))
    }

    res.json({ success: true, removed: all ? 'all' : bnames.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/embeddings/:bname', async (req, res) => {
  const bname = req.params.bname
  const { bucket, prefix, region } = req.query
  const awsBucket = bucket || process.env.S3_BUCKET
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  if (!awsBucket) return res.status(400).json({ error: 'S3 bucket not configured' })

  let S3Client, GetObjectCommand, PutObjectCommand
  try {
    ;({ S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found' })
  }

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })

  const base        = prefix || ''
  const embKey      = base ? `${base}/private/embeddings.json` : 'private/embeddings.json'
  const manifestKey = base ? `${base}/manifest.json`           : 'manifest.json'

  const readJson = async (key) => {
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: key }))
      const chunks = []
      for await (const chunk of resp.Body) chunks.push(chunk)
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      if (err.name !== 'NoSuchKey') throw err
      return null
    }
  }

  const writeJson = (key, data) => s3.send(new PutObjectCommand({
    Bucket: awsBucket, Key: key, Body: JSON.stringify(data, null, 2), ContentType: 'application/json',
  }))

  try {
    const [store, manifest] = await Promise.all([readJson(embKey), readJson(manifestKey)])

    if (store) {
      store.entries = (store.entries || []).filter(e => e.bname !== bname)
      store.updatedAt = new Date().toISOString()
      await writeJson(embKey, store)
    }

    if (manifest) {
      const filtered = manifest.filter(p => {
        const url = p.original || p.src || ''
        const bn = url.split('/').pop().replace(/\.[^.]+$/, '')
        return bn !== bname
      })
      if (filtered.length !== manifest.length) {
        await writeJson(manifestKey, filtered)
        // Keep local photos.json in sync
        const photosJsonPath = path.join(__dirname, '..', 'data', 'photos.json')
        try { fs.writeFileSync(photosJsonPath, JSON.stringify(filtered, null, 2)) } catch {}
      }
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Search Lab: list available local indices ──────────────────────────────────
app.get('/api/search-indices', (req, res) => {
  const ALL_METHODS = ['titan', 'nova', 'clip-vitb32', 'clip-vitl14']
  const indices = ALL_METHODS.map(method => {
    const p = path.join(INDICES_DIR, `${method}.json`)
    if (!fs.existsSync(p)) return { method, available: false }
    try {
      const count = Object.keys(JSON.parse(fs.readFileSync(p, 'utf8'))).length
      const sizeKb = Math.round(fs.statSync(p).size / 1024)
      return { method, available: true, count, sizeKb }
    } catch {
      return { method, available: false }
    }
  })
  const imageCount = fs.existsSync(CACHE_IMAGE_DIR)
    ? fs.readdirSync(CACHE_IMAGE_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length
    : 0
  res.json({ indices, imageCount })
})

// ── Search Lab: run compare.py --search --json ────────────────────────────────
app.post('/api/search-compare', (req, res) => {
  const { query, top = 8 } = req.body
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query required' })
  }

  if (!fs.existsSync(COMPARE_PY)) {
    return res.status(500).json({ error: 'compare.py not found' })
  }

  const result = spawnSync(
    'python3',
    [COMPARE_PY, '--search', query.trim(), '--top', String(top), '--json'],
    { cwd: PLAYGROUND_DIR, timeout: 60000, encoding: 'utf8' }
  )

  if (result.error) return res.status(500).json({ error: result.error.message })
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    return res.status(500).json({ error: stderr || 'compare.py exited with error' })
  }

  try {
    // stdout may have warnings before the JSON line — find the last line that parses
    const lines = (result.stdout || '').trim().split('\n')
    let parsed = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try { parsed = JSON.parse(lines[i]); break } catch {}
    }
    if (!parsed) throw new Error('No JSON in output')
    res.json(parsed)
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse compare.py output: ' + e.message })
  }
})

// ── Pipeline: Read manifest directly from S3 ────────────────────────────────

app.get('/api/s3-manifest', async (req, res) => {
  const { bucket, prefix, region } = req.query
  const awsBucket = bucket || process.env.S3_BUCKET || 'joshs-photo-storage'
  const awsRegion = region || process.env.AWS_REGION || 'us-east-1'
  const base = prefix || process.env.S3_PREFIX || ''

  let S3Client, GetObjectCommand
  try {
    ;({ S3Client, GetObjectCommand } = require('@aws-sdk/client-s3'))
  } catch {
    return res.status(500).json({ error: '@aws-sdk/client-s3 not found' })
  }

  const s3 = new S3Client({
    region: awsRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })

  const manifestKey = base ? `${base}/manifest.json` : 'manifest.json'

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: awsBucket, Key: manifestKey }))
    const chunks = []
    for await (const chunk of resp.Body) chunks.push(chunk)
    const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.json(manifest)
  } catch (err) {
    if (err.name === 'NoSuchKey') return res.json([])
    res.status(500).json({ error: err.message })
  }
})

// ── Pipeline: Step Functions triggers ─────────────────────────────────────────

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN || 'arn:aws:states:us-east-1:650251684846:stateMachine:josh-portfolio-photo-pipeline'

function getSfnClient() {
  const { SFNClient } = require('@aws-sdk/client-sfn')
  const region = process.env.AWS_REGION || 'us-east-1'
  return new SFNClient({
    region,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })
}

// Trigger pipeline for a single photo
app.post('/api/process/photo', async (req, res) => {
  const { bname, album, filename, startAt, bucket, prefix, region } = req.body
  if (!bname) return res.status(400).json({ error: 'bname required' })

  const { StartExecutionCommand } = require('@aws-sdk/client-sfn')
  const sfn = getSfnClient()
  const s3Config = getS3RuntimeConfig({ bucket, prefix, region })
  let resolved = null
  if (!filename || !album) resolved = await findPipelinePhoto(s3Config, bname)

  const input = {
    bucket: s3Config.bucket,
    prefix: s3Config.prefix,
    album: album || resolved?.album || '',
    bname,
    filename: filename || photoFilename(resolved) || `${bname}.jpg`,
    startAt: startAt || 'resize',
  }

  try {
    const execName = `${bname}-${Date.now()}`
    const result = await sfn.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: execName,
      input: JSON.stringify(input),
    }))
    res.json({ executionArn: result.executionArn, startDate: result.startDate })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Trigger pipeline for all photos (or filtered subset)
app.post('/api/process/all', async (req, res) => {
  const { startAt, photos, bucket, prefix, region } = req.body
  const { StartExecutionCommand } = require('@aws-sdk/client-sfn')
  const sfn = getSfnClient()
  const s3Config = getS3RuntimeConfig({ bucket, prefix, region })
  let targets = Array.isArray(photos) ? photos : null
  if (!targets) {
    const manifest = await loadPipelineManifest(s3Config)
    targets = manifest.map(p => ({
      bname: photoBname(p),
      filename: photoFilename(p),
      album: p.album || '',
    })).filter(p => p.bname && p.filename)
  }

  const results = []
  let started = 0
  let failed = 0

  for (const p of targets) {
    const bn = p.bname
    const fname = p.filename || `${bn}.jpg`
    if (!bn) continue
    const input = {
      bucket: s3Config.bucket,
      prefix: s3Config.prefix,
      album: p.album || '',
      bname: bn,
      filename: fname || `${bn}.jpg`,
      startAt: startAt || 'resize',
    }

    try {
      const execName = `${bn}-${Date.now()}`
      const result = await sfn.send(new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: execName,
        input: JSON.stringify(input),
      }))
      results.push({ bname: bn, executionArn: result.executionArn })
      started++
      // Stagger launches to avoid Lambda throttling
      if (started % 5 === 0) await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      results.push({ bname: bn, error: err.message })
      failed++
    }
  }

  res.json({ started, failed, total: targets.length, results })
})

// Check execution status
app.get('/api/process/status', async (req, res) => {
  const { executionArn } = req.query
  if (!executionArn) return res.status(400).json({ error: 'executionArn required' })

  const { DescribeExecutionCommand } = require('@aws-sdk/client-sfn')
  const sfn = getSfnClient()

  try {
    const result = await sfn.send(new DescribeExecutionCommand({ executionArn }))
    res.json({
      status: result.status,
      startDate: result.startDate,
      stopDate: result.stopDate,
      output: result.output ? JSON.parse(result.output) : null,
      error: result.error,
      cause: result.cause,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// List recent executions
app.get('/api/process/executions', async (req, res) => {
  const { status } = req.query
  const { ListExecutionsCommand } = require('@aws-sdk/client-sfn')
  const sfn = getSfnClient()

  try {
    const params = { stateMachineArn: STATE_MACHINE_ARN, maxResults: 100 }
    if (status) params.statusFilter = status
    const result = await sfn.send(new ListExecutionsCommand(params))
    const executions = (result.executions || []).map(e => ({
      executionArn: e.executionArn,
      name: e.name,
      status: e.status,
      startDate: e.startDate,
      stopDate: e.stopDate,
    }))
    res.json({ executions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Pipeline: Test a single Lambda step directly ─────────────────────────────

app.post('/api/process/test-step', async (req, res) => {
  const { bname, album, filename, step, bucket, prefix, region } = req.body
  if (!bname || !step) return res.status(400).json({ error: 'bname and step required' })

  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda')
  const lambdaRegion = process.env.AWS_REGION || 'us-east-1'
  const lambda = new LambdaClient({
    region: lambdaRegion,
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    }),
  })

  const s3Config = getS3RuntimeConfig({ bucket, prefix, region })
  let resolved = null
  if (!filename || !album) resolved = await findPipelinePhoto(s3Config, bname)

  const payload = {
    step,
    bucket: s3Config.bucket,
    prefix: s3Config.prefix,
    album: album || resolved?.album || '',
    bname,
    filename: filename || photoFilename(resolved) || `${bname}.jpg`,
  }

  try {
    const result = await lambda.send(new InvokeCommand({
      FunctionName: process.env.LAMBDA_FUNCTION_NAME || 'josh-portfolio-photo-processor',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(payload),
    }))

    const responsePayload = JSON.parse(Buffer.from(result.Payload).toString())

    if (result.FunctionError) {
      return res.status(500).json({
        error: responsePayload.errorMessage || 'Lambda error',
        errorType: responsePayload.errorType,
        trace: responsePayload.trace,
        input: payload,
      })
    }

    res.json({ result: responsePayload, input: payload })
  } catch (err) {
    res.status(500).json({ error: err.message, input: payload })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`\n  Portfolio Admin  →  http://localhost:${PORT}\n`)
})
