// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  view: 'uploader',
  step: 1,
  sourceDir: localStorage.getItem('admin_dir') || '',
  photos: [],
  availableTags: [],
  colorLab: {
    sourceDir: localStorage.getItem('color_lab_dir') || localStorage.getItem('admin_dir') || '',
    loading: false,
    progress: { done: 0, total: 0 },
    profiles: [],
    errors: [],
    profileMethod: 'average',
    sortMode: 'hue',
    layout: localStorage.getItem('color_lab_layout') || 'grid',
  },
  s3Config: {
    bucket: 'joshs-photo-storage',
    prefix: 'bin',
    region: 'us-east-1',
    album:               localStorage.getItem('admin_album') || '',
    albumName:           localStorage.getItem('admin_album_name') || '',
    collectionDescription: localStorage.getItem('admin_collection_desc') || '',
  },
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function baseOf(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(0, i) : name
}

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function previewSrc(filepath, bust) {
  return `/api/preview?filepath=${encodeURIComponent(filepath)}&thumb=1${bust ? '&t=' + bust : ''}`
}

function colorPreviewSrc(filepath, masonry = false) {
  const fit = masonry ? '&fit=inside' : ''
  return `/api/preview?filepath=${encodeURIComponent(filepath)}&thumb=1${fit}`
}

function thumbHtml(filepath, cls = '', bust) {
  return `<img
    class="${cls}"
    src="${previewSrc(filepath, bust)}"
    loading="lazy"
    onerror="this.style.opacity='0.15'"
  />`
}

const COLOR_CACHE_KEY = 'color_lab_cache_v1'

function loadColorCache() {
  try {
    const raw = localStorage.getItem(COLOR_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveColorCache(cache) {
  try {
    const entries = Object.entries(cache).sort((a, b) => {
      const at = a[1]?.updatedAt || ''
      const bt = b[1]?.updatedAt || ''
      return bt.localeCompare(at)
    })
    const trimmed = Object.fromEntries(entries.slice(0, 1200))
    localStorage.setItem(COLOR_CACHE_KEY, JSON.stringify(trimmed))
  } catch {
    // Ignore storage errors (private mode, quota reached, etc.)
  }
}

const colorCache = loadColorCache()

function colorCacheId(photo) {
  return `${photo.filepath}::${photo.size}`
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2

  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function srgbToLinear(v) {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgbToLab(r, g, b) {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)

  // D65, sRGB
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) * 100
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) * 100

  const xr = x / 95.047
  const yr = y / 100.0
  const zr = z / 108.883

  const f = (t) => (t > 0.008856 ? t ** (1 / 3) : (7.787 * t) + (16 / 116))
  const fx = f(xr)
  const fy = f(yr)
  const fz = f(zr)

  return {
    L: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function deltaE2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1
  const { L: L2, a: a2, b: b2 } = lab2

  const avgLp = (L1 + L2) / 2
  const C1 = Math.sqrt((a1 * a1) + (b1 * b1))
  const C2 = Math.sqrt((a2 * a2) + (b2 * b2))
  const avgC = (C1 + C2) / 2

  const G = 0.5 * (1 - Math.sqrt((avgC ** 7) / ((avgC ** 7) + (25 ** 7))))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.sqrt((a1p * a1p) + (b1 * b1))
  const C2p = Math.sqrt((a2p * a2p) + (b2 * b2))
  const avgCp = (C1p + C2p) / 2

  const hRad = (a, b) => {
    if (a === 0 && b === 0) return 0
    const h = Math.atan2(b, a)
    return h >= 0 ? h : h + (2 * Math.PI)
  }

  const h1p = hRad(a1p, b1)
  const h2p = hRad(a2p, b2)
  const toDeg = (r) => r * (180 / Math.PI)
  const toRad = (d) => d * (Math.PI / 180)
  const h1pDeg = toDeg(h1p)
  const h2pDeg = toDeg(h2p)

  const dLp = L2 - L1
  const dCp = C2p - C1p

  let dhpDeg = 0
  if (C1p * C2p !== 0) {
    const diff = h2pDeg - h1pDeg
    if (Math.abs(diff) <= 180) dhpDeg = diff
    else if (diff > 180) dhpDeg = diff - 360
    else dhpDeg = diff + 360
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(toRad(dhpDeg / 2))

  let avgHpDeg = h1pDeg + h2pDeg
  if (C1p * C2p !== 0) {
    if (Math.abs(h1pDeg - h2pDeg) > 180) avgHpDeg += 360
    avgHpDeg /= 2
    if (avgHpDeg >= 360) avgHpDeg -= 360
  }

  const T = 1
    - (0.17 * Math.cos(toRad(avgHpDeg - 30)))
    + (0.24 * Math.cos(toRad(2 * avgHpDeg)))
    + (0.32 * Math.cos(toRad((3 * avgHpDeg) + 6)))
    - (0.20 * Math.cos(toRad((4 * avgHpDeg) - 63)))

  const dTheta = 30 * Math.exp(-(((avgHpDeg - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt((avgCp ** 7) / ((avgCp ** 7) + (25 ** 7)))

  const Sl = 1 + ((0.015 * ((avgLp - 50) ** 2)) / Math.sqrt(20 + ((avgLp - 50) ** 2)))
  const Sc = 1 + (0.045 * avgCp)
  const Sh = 1 + (0.015 * avgCp * T)
  const Rt = -(Math.sin(toRad(2 * dTheta)) * Rc)

  const dE = Math.sqrt(
    (dLp / Sl) ** 2 +
    (dCp / Sc) ** 2 +
    (dHp / Sh) ** 2 +
    Rt * (dCp / Sc) * (dHp / Sh)
  )

  return dE
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

function computeProfilesFromImage(img) {
  const maxEdge = 220
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data

  const totalPixels = width * height
  const stride = totalPixels > 45000 ? 3 : 1
  let samples = 0

  let avgR = 0, avgG = 0, avgB = 0
  let weightedR = 0, weightedG = 0, weightedB = 0
  let weightSum = 0
  const buckets = new Map()

  for (let px = 0; px < totalPixels; px += stride) {
    const i = px * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3] / 255
    if (a <= 0.02) continue

    avgR += r
    avgG += g
    avgB += b

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const saturation = max === 0 ? 0 : (max - min) / max
    const value = max / 255
    const weight = 0.65 + saturation * 1.25 + value * 0.35

    weightedR += r * weight
    weightedG += g * weight
    weightedB += b * weight
    weightSum += weight

    const qr = Math.floor(r / 32)
    const qg = Math.floor(g / 32)
    const qb = Math.floor(b / 32)
    const key = `${qr}-${qg}-${qb}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }

    samples += 1
  }

  if (samples === 0) throw new Error('No usable pixels found')

  const averageRgb = {
    r: clamp255(avgR / samples),
    g: clamp255(avgG / samples),
    b: clamp255(avgB / samples),
  }
  const vibrantRgb = {
    r: clamp255(weightedR / Math.max(weightSum, 1)),
    g: clamp255(weightedG / Math.max(weightSum, 1)),
    b: clamp255(weightedB / Math.max(weightSum, 1)),
  }

  let dominant = null
  for (const bucket of buckets.values()) {
    if (!dominant || bucket.count > dominant.count) dominant = bucket
  }

  const dominantRgb = dominant ? {
    r: clamp255(dominant.r / dominant.count),
    g: clamp255(dominant.g / dominant.count),
    b: clamp255(dominant.b / dominant.count),
  } : averageRgb

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
    const lab = rgbToLab(rgb.r, rgb.g, rgb.b)
    return {
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
      lab,
      weight: p.count / paletteWeightSum,
    }
  })

  return {
    average: { rgb: averageRgb, hsl: rgbToHsl(averageRgb.r, averageRgb.g, averageRgb.b) },
    vibrant: { rgb: vibrantRgb, hsl: rgbToHsl(vibrantRgb.r, vibrantRgb.g, vibrantRgb.b) },
    dominant: { rgb: dominantRgb, hsl: rgbToHsl(dominantRgb.r, dominantRgb.g, dominantRgb.b) },
    palette,
    sampleCount: samples,
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null
function toast(msg, type = 'error') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = type
  el.style.display = 'block'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.style.display = 'none' }, type === 'error' ? 6000 : 3000)
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

// ── Navigation ────────────────────────────────────────────────────────────────
function goToStep(n) {
  if (state.view !== 'uploader') return
  if (n < 1 || n > 3) return
  if (n > 1 && state.photos.length === 0) return
  state.step = n
  render()
}

function switchView(view) {
  if (!['uploader', 'color-lab', 'embeddings', 'search-lab', 'pipeline'].includes(view)) return
  state.view = view
  if (view === 'search-lab' && searchLabState.indices.length === 0) loadSearchIndices()
  if (view === 'pipeline' && pipelineState.photos.length === 0) loadPipelineStatus()
  render()
}

function resetSession() {
  if (!confirm('Clear all photos and start over?')) return
  state.photos = []
  state.step = 1
  render()
}

// ── Step 1: Load ──────────────────────────────────────────────────────────────
async function loadPhotos() {
  const dirInput = document.getElementById('dir-input')
  const dir = dirInput.value.trim()
  if (!dir) return

  state.sourceDir = dir
  localStorage.setItem('admin_dir', dir)

  const btn = document.getElementById('load-btn')
  btn.disabled = true
  btn.textContent = 'Loading…'

  try {
    const { images } = await api(`/api/photos?dir=${encodeURIComponent(dir)}`)

    state.photos = images.map((img, i) => ({
      id: `p${i}`,
      filepath: img.filepath,
      name: img.name,
      basename: baseOf(img.name),
      ext: extOf(img.name),
      title: '',
      tags: [],
      description: '',
      size: img.size,
      status: 'pending',
      url: null,
      error: null,
      cacheBust: null,
      selected: true,
    }))

    render()
  } catch (err) {
    toast('Failed to load: ' + err.message)
    btn.disabled = false
    btn.textContent = 'Load'
  }
}

function renderStep1(container) {
  container.innerHTML = `
    <div>
      <div class="step-header">
        <h2>Load Photos</h2>
        <p>Enter the absolute path to your local photos directory</p>
      </div>

      <div class="dir-row">
        <input
          id="dir-input"
          type="text"
          placeholder="/Users/you/Photos/batch001"
          value="${esc(state.sourceDir)}"
          spellcheck="false"
        />
        <button id="load-btn" class="btn-primary" onclick="loadPhotos()">Load</button>
      </div>

      ${state.photos.length > 0 ? `
        <div class="load-bar">
          <span class="count-badge">${state.photos.length} photos found</span>
          <button class="btn-primary" onclick="goToStep(2)">Continue to Tag →</button>
        </div>

        <div class="photo-grid">
          ${state.photos.map(p => `
            <div class="photo-card">
              <div class="thumb-wrap">
                <img
                  src="${previewSrc(p.filepath)}"
                  loading="lazy"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                />
                <div class="thumb-placeholder">
                  <span>🖼</span>
                  <span>${esc(p.ext)}</span>
                </div>
              </div>
              <div class="photo-meta">
                <span class="photo-name" title="${esc(p.name)}">${esc(p.name)}</span>
                <span class="photo-size">${fmtSize(p.size)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `

  const input = document.getElementById('dir-input')
  input.addEventListener('keydown', e => { if (e.key === 'Enter') loadPhotos() })
  input.focus()
}

// ── Rotation ──────────────────────────────────────────────────────────────────
async function rotatePhoto(idx, degrees) {
  const photo = state.photos[idx]
  const btn = document.querySelector(`#rc-${idx} [data-deg="${degrees}"]`)
  if (btn) { btn.disabled = true; btn.textContent = '…' }

  try {
    await api('/api/rotate', { method: 'POST', body: { filepath: photo.filepath, degrees } })
    photo.cacheBust = Date.now()
    const img = document.querySelector(`#rc-${idx} img`)
    if (img) img.src = previewSrc(photo.filepath, photo.cacheBust)
  } catch (err) {
    toast('Rotate failed: ' + err.message)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = degrees === 90 ? '↻' : '↺' }
  }
}

// ── Tag combobox (per-photo) ───────────────────────────────────────────────────
function tagPickerHtml(idx) {
  const tags = state.photos[idx].tags
  const pills = tags.map(tag =>
    `<span class="tag-pill" onmousedown="event.preventDefault();removeTag(${idx},'${tag}')">${esc(tag)} <span class="pill-x">×</span></span>`
  ).join('')

  return `
    <div class="tag-combobox" id="tc-${idx}">
      <div class="tag-combobox-inner" onclick="document.getElementById('tci-${idx}').focus()">
        ${pills}
        <input
          id="tci-${idx}"
          class="tag-combobox-input"
          type="text"
          placeholder="${tags.length === 0 ? 'Add tags…' : ''}"
          autocomplete="off"
          spellcheck="false"
          oninput="updateTagDropdown(${idx},this.value)"
          onfocus="updateTagDropdown(${idx},this.value)"
          onblur="scheduleHideDropdown(${idx})"
          onkeydown="handleTagKey(event,${idx},this)"
        />
      </div>
      <div class="tag-combobox-dropdown" id="tdd-${idx}"></div>
    </div>
  `
}

function updateTagPicker(idx) {
  const el = document.getElementById(`tp-${idx}`)
  if (el) el.innerHTML = tagPickerHtml(idx)
}

function removeTag(idx, tag) {
  state.photos[idx].tags = state.photos[idx].tags.filter(t => t !== tag)
  updateTagPicker(idx)
  updateBulkPicker()
  // re-focus input after removing
  setTimeout(() => document.getElementById(`tci-${idx}`)?.focus(), 0)
}

function toggleTag(idx, tag) {
  const tags = state.photos[idx].tags
  const i = tags.indexOf(tag)
  if (i >= 0) tags.splice(i, 1)
  else tags.push(tag)
  updateTagPicker(idx)
  updateBulkPicker()
}

function pickTag(idx, tag) {
  if (!state.photos[idx].tags.includes(tag)) state.photos[idx].tags.push(tag)
  const input = document.getElementById(`tci-${idx}`)
  if (input) { input.value = ''; input.focus() }
  updateTagPicker(idx)
  updateBulkPicker()
}

function updateTagDropdown(idx, value) {
  const dropdown = document.getElementById(`tdd-${idx}`)
  if (!dropdown) return

  const selected = new Set(state.photos[idx].tags)
  const filter   = value.toLowerCase().trim()
  const matches  = state.availableTags.filter(t => !selected.has(t) && (!filter || t.includes(filter)))

  let html = matches.map(tag =>
    `<button class="tag-drop-item" onmousedown="event.preventDefault();pickTag(${idx},'${tag}')">${esc(tag)}</button>`
  ).join('')

  // "Create" option if typed value doesn't exactly match an existing tag
  const normalized = filter.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (filter && !state.availableTags.includes(normalized) && !selected.has(normalized)) {
    html += `<button class="tag-drop-item tag-drop-create" onmousedown="event.preventDefault();createTagInline(${idx})">+ Create "<strong>${esc(filter)}</strong>"</button>`
  }

  dropdown.innerHTML = html
  dropdown.style.display = html ? 'block' : 'none'
}

const _hideTimers = {}
function scheduleHideDropdown(idx) {
  _hideTimers[idx] = setTimeout(() => {
    const el = document.getElementById(`tdd-${idx}`)
    if (el) el.style.display = 'none'
  }, 150)
}

function handleTagKey(event, idx, input) {
  if (event.key === 'Enter') {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    const selected = new Set(state.photos[idx].tags)
    const filter   = value.toLowerCase()
    const match    = state.availableTags.find(t => !selected.has(t) && t.includes(filter))
    if (match) pickTag(idx, match)
    else createTagInline(idx)
  } else if (event.key === 'Backspace' && input.value === '') {
    const tags = state.photos[idx].tags
    if (tags.length) { tags.pop(); updateTagPicker(idx); updateBulkPicker() }
  } else if (event.key === 'Escape') {
    input.value = ''
    const dd = document.getElementById(`tdd-${idx}`)
    if (dd) dd.style.display = 'none'
  }
}

async function createTagInline(idx) {
  const input = document.getElementById(`tci-${idx}`)
  const raw   = input?.value.trim()
  if (!raw) return
  try {
    const { tag, tags } = await api('/api/tags', { method: 'POST', body: { tag: raw } })
    state.availableTags = tags
    if (!state.photos[idx].tags.includes(tag)) state.photos[idx].tags.push(tag)
    if (input) { input.value = ''; input.focus() }
    updateTagPicker(idx)
    updateBulkPicker()
  } catch (err) {
    toast('Could not create tag: ' + err.message)
  }
}

// ── Bulk picker ───────────────────────────────────────────────────────────────
function bulkPickerHtml() {
  return state.availableTags.map(tag => {
    const count = state.photos.filter(p => p.tags.includes(tag)).length
    const cls = count === state.photos.length ? 'on' : count > 0 ? 'some' : ''
    const label = count > 0 ? `${esc(tag)} <span class="chip-count">${count}</span>` : esc(tag)
    return `<button class="tag-chip ${cls}" onclick="bulkToggleTag('${tag}')">${label}</button>`
  }).join('')
}

function updateBulkPicker() {
  const el = document.getElementById('bulk-picker')
  if (el) el.innerHTML = bulkPickerHtml()
}

function bulkToggleTag(tag) {
  const allHave = state.photos.every(p => p.tags.includes(tag))
  state.photos.forEach(p => {
    if (allHave) {
      p.tags = p.tags.filter(t => t !== tag)
    } else if (!p.tags.includes(tag)) {
      p.tags.push(tag)
    }
  })
  state.photos.forEach((_, i) => updateTagPicker(i))
  updateBulkPicker()
}

async function createBulkTag(input) {
  const raw = input.value.trim()
  if (!raw) return
  try {
    const { tag, tags } = await api('/api/tags', { method: 'POST', body: { tag: raw } })
    state.availableTags = tags
    state.photos.forEach(p => { if (!p.tags.includes(tag)) p.tags.push(tag) })
    input.value = ''
    updateBulkPicker()
    state.photos.forEach((_, i) => updateTagPicker(i))
  } catch (err) {
    toast('Could not create tag: ' + err.message)
  }
}

// ── Step 2: Rotate & Tag ──────────────────────────────────────────────────────
function renderTagGrid() {
  const grid = document.getElementById('tag-grid')
  if (!grid) return

  grid.innerHTML = state.photos.map((p, i) => `
    <div class="tag-card">
      <div class="tag-thumb" id="rc-${i}">
        <img src="${previewSrc(p.filepath, p.cacheBust)}" loading="lazy" onerror="this.style.opacity='0.15'" />
        <div class="rotate-controls">
          <button class="rotate-btn" data-deg="270" onclick="rotatePhoto(${i}, 270)" title="Rotate left">↺</button>
          <button class="rotate-btn" data-deg="90"  onclick="rotatePhoto(${i}, 90)"  title="Rotate right">↻</button>
        </div>
        <span class="tag-fname">${esc(p.name)}</span>
      </div>
      <div class="tag-fields">
        <label>
          <span class="field-label">Title</span>
          <input
            type="text"
            value="${esc(p.title)}"
            placeholder="Photo title"
            oninput="state.photos[${i}].title = this.value"
          />
        </label>
        <div>
          <span class="field-label" style="display:block;margin-bottom:6px">Tags</span>
          <div class="tag-picker" id="tp-${i}">${tagPickerHtml(i)}</div>
        </div>
        <label>
          <span class="field-label">Caption <small style="font-weight:400;text-transform:none">(optional — used as embedding context)</small></span>
          <textarea rows="2" placeholder="e.g. Wagyu A5 at Nobu Malibu, golden hour at the summit…" oninput="state.photos[${i}].description = this.value">${esc(p.description)}</textarea>
        </label>
      </div>
    </div>
  `).join('')
}

function renderStep2(container) {
  container.innerHTML = `
    <div>
      <div class="step-header">
        <h2>Rotate & Tag</h2>
        <p>${state.photos.length} photos — hover a photo to rotate, then add tags and metadata</p>
      </div>

      <div class="panel">
        <h3>Bulk Tagging — click to add/remove a tag across all photos</h3>
        <div id="bulk-picker" class="tp-chips" style="margin-bottom:12px">${bulkPickerHtml()}</div>
        <div class="tp-add">
          <input
            class="tp-input"
            type="text"
            placeholder="New tag for all…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();createBulkTag(this)}"
          />
          <button class="tp-add-btn" onclick="createBulkTag(this.previousElementSibling)">+ Add to all</button>
        </div>
        <p class="hint" style="margin-top:10px">
          <span style="color:var(--primary)">Solid</span> = all photos have this tag ·
          <span style="color:var(--primary);opacity:.5">Dashed</span> = some photos have it ·
          Grey = none
        </p>
      </div>

      <div id="tag-grid" class="tag-grid"></div>

      <div class="step-footer">
        <button class="btn-ghost" onclick="goToStep(1)">← Back</button>
        <button class="btn-primary" onclick="goToStep(3)">Continue to Upload →</button>
      </div>
    </div>
  `

  renderTagGrid()
}

// ── Step 3: Upload ────────────────────────────────────────────────────────────
function toggleSelect(id) {
  const photo = state.photos.find(p => p.id === id)
  if (!photo || photo.status === 'done' || photo.status === 'uploading') return
  photo.selected = !photo.selected
  const row = document.getElementById(`urow-${id}`)
  if (row) row.classList.toggle('deselected', !photo.selected)
  const cb = row?.querySelector('.upload-checkbox')
  if (cb) cb.checked = photo.selected
  updateUploadButton()
}

function selectAll(val) {
  state.photos.forEach(p => {
    if (p.status !== 'done' && p.status !== 'uploading') p.selected = val
  })
  refreshUploadList()
  updateUploadButton()
}

function updateUploadButton() {
  const btn = document.getElementById('upload-btn')
  if (!btn) return
  const count = state.photos.filter(p => p.selected && (p.status === 'pending' || p.status === 'error')).length
  btn.disabled = count === 0
  btn.textContent = count > 0 ? `Upload ${count} Photo${count !== 1 ? 's' : ''}` : 'None Selected'
}

function refreshUploadList() {
  const list = document.getElementById('upload-list')
  if (!list) return

  const icons = { pending: '○', uploading: '⟳', done: '✓', error: '✗' }

  list.innerHTML = state.photos.map(p => {
    const deselected = !p.selected && p.status !== 'done' && p.status !== 'uploading'
    const interactive = p.status !== 'done' && p.status !== 'uploading'
    return `
      <div class="upload-row ${p.status} ${deselected ? 'deselected' : ''}" id="urow-${p.id}">
        <input
          type="checkbox"
          class="upload-checkbox"
          ${p.selected ? 'checked' : ''}
          ${interactive ? '' : 'disabled'}
          onchange="toggleSelect('${p.id}')"
        />
        <span class="upload-status-icon">${icons[p.status] || '○'}</span>
        ${thumbHtml(p.filepath, 'upload-thumb', p.cacheBust)}
        <div class="upload-info">
          <span class="upload-filename">${esc(p.name)}</span>
          <span class="upload-meta">${p.tags.length ? p.tags.join(', ') : '—'} · ${esc(p.title) || '—'}</span>
        </div>
        ${p.status === 'done' ? `<a class="upload-link" href="${p.url}" target="_blank" rel="noopener">View ↗</a>` : ''}
        ${p.status === 'error' ? `<span class="upload-err-text" title="${esc(p.error)}">${esc(p.error)}</span>` : ''}
      </div>
    `
  }).join('')
}

function updateRowStatus(photo) {
  const row = document.getElementById(`urow-${photo.id}`)
  if (!row) return

  const icons = { pending: '○', uploading: '⟳', done: '✓', error: '✗' }
  row.className = `upload-row ${photo.status}`
  row.querySelector('.upload-status-icon').textContent = icons[photo.status] || '○'

  const existingLink = row.querySelector('.upload-link')
  const existingErr = row.querySelector('.upload-err-text')
  if (existingLink) existingLink.remove()
  if (existingErr) existingErr.remove()

  if (photo.status === 'done' && photo.url) {
    const a = document.createElement('a')
    a.className = 'upload-link'
    a.href = photo.url
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = 'View ↗'
    row.appendChild(a)
  } else if (photo.status === 'error' && photo.error) {
    const span = document.createElement('span')
    span.className = 'upload-err-text'
    span.title = photo.error
    span.textContent = photo.error
    row.appendChild(span)
  }
}

async function uploadAll() {
  const btn = document.getElementById('upload-btn')
  btn.disabled = true

  const bucket      = document.getElementById('s3-bucket').value.trim()
  const prefix      = 'bin'
  const region      = document.getElementById('s3-region').value.trim()
  const album       = document.getElementById('s3-album').value.trim()     || 'misc'
  const albumName   = document.getElementById('s3-album-name').value.trim() || 'Miscellaneous'
  const collectionDescription = document.getElementById('s3-collection-desc').value.trim()
  state.s3Config = { bucket, prefix, region, album, albumName, collectionDescription }
  localStorage.setItem('admin_album', album)
  localStorage.setItem('admin_album_name', albumName)
  localStorage.setItem('admin_collection_desc', collectionDescription)

  // ── Write collection metadata to S3 before uploading photos ──────────────
  // This guarantees Lambda can find the description when it processes each original.
  let collectionId = null
  if (true) {  // always create/update collection (defaults to Miscellaneous)
    try {
      const col = await api('/api/collections', {
        method: 'POST',
        body: { collectionName: albumName, collectionDescription, s3Album: album, bucket, prefix, region },
      })
      collectionId = col.collection.id
    } catch (err) {
      toast('Warning: could not save collection metadata — ' + err.message)
      // Don't abort — photos can still upload without collection metadata
    }
  }

  const pending = state.photos.filter(p => p.selected && (p.status === 'pending' || p.status === 'error'))
  let doneCount = state.photos.filter(p => p.status === 'done').length

  for (const photo of pending) {
    photo.status = 'uploading'
    updateRowStatus(photo)

    try {
      const result = await api('/api/upload', {
        method: 'POST',
        body: {
          filepath: photo.filepath,
          bucket,
          prefix,
          region,
          album,
          albumName,
          collectionId,
          title: photo.title,
          tags: photo.tags,
          description: photo.description,
        },
      })
      photo.status = 'done'
      photo.url = result.entry.medium
      doneCount++
    } catch (err) {
      photo.status = 'error'
      photo.error = err.message
    }

    updateRowStatus(photo)

    const prog = document.getElementById('upload-progress')
    if (prog) prog.textContent = `${doneCount} / ${state.photos.length}`
  }

  const total = state.photos.length
  const errors = state.photos.filter(p => p.status === 'error').length
  const summary = document.getElementById('upload-summary')

  const retryable = state.photos.filter(p => p.status === 'error').length
  if (errors === 0) {
    summary.innerHTML = `<div class="banner success">✓ ${pending.length} photo${pending.length !== 1 ? 's' : ''} uploaded — Lambda will generate derived sizes</div>`
  } else {
    summary.innerHTML = `<div class="banner partial">${doneCount}/${total} uploaded · ${errors} failed</div>`
    btn.disabled = false
    btn.textContent = `Retry ${retryable} Failed`
  }
}

function renderStep3(container) {
  const pending  = state.photos.filter(p => p.status === 'pending' || p.status === 'error').length
  const done     = state.photos.filter(p => p.status === 'done').length
  const selected = state.photos.filter(p => p.selected && (p.status === 'pending' || p.status === 'error')).length

  container.innerHTML = `
    <div>
      <div class="step-header">
        <h2>Upload to S3</h2>
        <p>${state.photos.length} photos · ${done} already uploaded · ${pending} pending</p>
      </div>

      <div class="panel">
        <h3>S3 Configuration</h3>
        <div class="config-grid">
          <label>
            <span class="field-label">Bucket</span>
            <input id="s3-bucket" type="text" value="${esc(state.s3Config.bucket)}" placeholder="joshs-photo-storage" />
          </label>
          <label>
            <span class="field-label">Region</span>
            <input id="s3-region" type="text" value="${esc(state.s3Config.region)}" placeholder="us-east-1" />
          </label>
          <label>
            <span class="field-label">Album path <small style="font-weight:400;text-transform:none">(optional)</small></span>
            <input id="s3-album" type="text" value="${esc(state.s3Config.album)}" placeholder="2025-switzerland" />
          </label>
          <label>
            <span class="field-label">Album name <small style="font-weight:400;text-transform:none">(display + tag)</small></span>
            <input id="s3-album-name" type="text" value="${esc(state.s3Config.albumName)}" placeholder="Switzerland 2025" />
          </label>
          <label class="config-full-row">
            <span class="field-label">Collection description <small style="font-weight:400;text-transform:none">— used as embedding context by Lambda</small></span>
            <textarea
              id="s3-collection-desc"
              rows="2"
              placeholder="Dramatic alpine landscapes, mountain villages, and glacier lakes in Switzerland..."
            >${esc(state.s3Config.collectionDescription)}</textarea>
          </label>
        </div>
        <p class="hint">
          Album path convention: <code>YYYY-location</code> kebab-case<br>
          Originals → <code>bin/originals/{album}/filename.jpg</code><br>
          Collection is saved to S3 before upload so Lambda has the description for embedding
        </p>
      </div>

      <div class="upload-actions">
        <button
          id="upload-btn"
          class="btn-primary btn-large"
          onclick="uploadAll()"
          ${selected === 0 ? 'disabled' : ''}
        >
          ${pending > 0 ? `Upload ${selected} Photo${selected !== 1 ? 's' : ''}` : 'All Uploaded ✓'}
        </button>
        <div class="select-actions">
          <button class="btn-ghost btn-sm" onclick="selectAll(true)">Select all</button>
          <button class="btn-ghost btn-sm" onclick="selectAll(false)">None</button>
        </div>
        <span class="progress-text" id="upload-progress">${done > 0 ? done + ' / ' + state.photos.length : ''}</span>
      </div>

      <div id="upload-summary"></div>
      <div id="upload-list" class="upload-list"></div>

      <div class="step-footer">
        <button class="btn-ghost" onclick="goToStep(2)">← Back</button>
      </div>
    </div>
  `

  refreshUploadList()
}

// ── Color Lab (browser-only color analysis) ──────────────────────────────────
async function loadColorLabPhotos({ forceRecompute = false } = {}) {
  const dirInput = document.getElementById('color-dir-input')
  const dir = (dirInput?.value || state.colorLab.sourceDir || '').trim()
  if (!dir) return

  state.colorLab.sourceDir = dir
  state.colorLab.loading = true
  state.colorLab.progress = { done: 0, total: 0 }
  state.colorLab.errors = []
  localStorage.setItem('color_lab_dir', dir)
  render()

  try {
    const { images } = await api(`/api/photos?dir=${encodeURIComponent(dir)}`)
    state.colorLab.progress.total = images.length

    const profiles = []
    for (let i = 0; i < images.length; i++) {
      const photo = images[i]
      const id = colorCacheId(photo)
      let entry = !forceRecompute ? colorCache[id] : null

      if (!entry?.profiles) {
        try {
          const img = await loadImage(previewSrc(photo.filepath))
          entry = {
            name: photo.name,
            filepath: photo.filepath,
            size: photo.size,
            profiles: computeProfilesFromImage(img),
            updatedAt: new Date().toISOString(),
          }
          colorCache[id] = entry
        } catch (err) {
          state.colorLab.errors.push({ filepath: photo.filepath, error: err.message })
        }
      }

      if (entry?.profiles) profiles.push(entry)

      state.colorLab.progress.done = i + 1
      if (i % 6 === 0 || i === images.length - 1) render()
    }

    saveColorCache(colorCache)
    state.colorLab.profiles = profiles
  } catch (err) {
    toast('Color analysis failed: ' + err.message)
  } finally {
    state.colorLab.loading = false
    render()
  }
}

function clearColorLabCache() {
  if (!confirm('Clear saved color profiles in this browser?')) return
  for (const key of Object.keys(colorCache)) delete colorCache[key]
  localStorage.removeItem(COLOR_CACHE_KEY)
  state.colorLab.profiles = []
  state.colorLab.errors = []
  state.colorLab.progress = { done: 0, total: 0 }
  render()
}

function setColorProfileMethod(method) {
  state.colorLab.profileMethod = method
  render()
}

function setColorSortMode(mode) {
  state.colorLab.sortMode = mode
  render()
}

function setColorLayout(layout) {
  if (!['grid', 'masonry'].includes(layout)) return
  state.colorLab.layout = layout
  localStorage.setItem('color_lab_layout', layout)
  render()
}

function hslOf(profile) {
  return profile.profiles?.[state.colorLab.profileMethod]?.hsl || { h: 0, s: 0, l: 0 }
}

function rgbOf(profile, method) {
  return profile.profiles?.[method]?.rgb || { r: 0, g: 0, b: 0 }
}

function labOf(profile) {
  const rgb = rgbOf(profile, state.colorLab.profileMethod)
  return rgbToLab(rgb.r, rgb.g, rgb.b)
}

function paletteOf(profile) {
  const palette = profile.profiles?.palette
  if (Array.isArray(palette) && palette.length > 0) {
    return palette.map((p) => ({
      weight: typeof p.weight === 'number' ? p.weight : 0,
      lab: p.lab || rgbToLab(p.rgb?.r || 0, p.rgb?.g || 0, p.rgb?.b || 0),
    }))
  }

  // Backward-compatible fallback for cached entries created before palette support.
  return [{ weight: 1, lab: labOf(profile) }]
}

function hueLabel(idx) {
  const labels = ['Red', 'Orange', 'Amber', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Sky', 'Blue', 'Violet', 'Magenta']
  return labels[idx] || `Hue ${idx + 1}`
}

function groupProfilesByHue(profiles) {
  const buckets = Array.from({ length: 12 }, (_, i) => ({ idx: i, items: [] }))
  for (const profile of profiles) {
    const { h } = hslOf(profile)
    const bin = Math.floor((h % 360) / 30)
    buckets[bin].items.push(profile)
  }
  return buckets.filter(b => b.items.length > 0)
}

function colorDistanceLab(a, b) {
  return deltaE2000(a, b)
}

function colorDistancePalette(a, b) {
  const directed = (from, to) => {
    let total = 0
    for (const fa of from) {
      let best = Number.POSITIVE_INFINITY
      for (const tb of to) {
        const d = colorDistanceLab(fa.lab, tb.lab)
        if (d < best) best = d
      }
      total += best * fa.weight
    }
    return total
  }

  return (directed(a, b) + directed(b, a)) / 2
}

function nearestNeighborOrder(profiles) {
  if (profiles.length <= 2) return profiles

  const labs = profiles.map(p => labOf(p))
  const remaining = new Set(profiles.map((_, i) => i))

  // Deterministic start point: darkest tone first.
  let current = profiles
    .map((_, i) => i)
    .sort((ia, ib) => {
      const a = labs[ia]
      const b = labs[ib]
      if (a.L !== b.L) return a.L - b.L
      if (a.a !== b.a) return a.a - b.a
      return a.b - b.b
    })[0]

  const orderedIdx = [current]
  remaining.delete(current)

  while (remaining.size > 0) {
    let best = -1
    let bestDist = Number.POSITIVE_INFINITY
    const currentLab = labs[current]

    for (const idx of remaining) {
      const d = colorDistanceLab(currentLab, labs[idx])
      if (d < bestDist) {
        bestDist = d
        best = idx
      }
    }

    current = best
    orderedIdx.push(current)
    remaining.delete(current)
  }

  const optimizedIdx = twoOptImproveOrder(orderedIdx, (x, y) => colorDistanceLab(labs[x], labs[y]), profiles.length)
  return optimizedIdx.map(i => profiles[i])
}

function nearestNeighborPaletteOrder(profiles) {
  if (profiles.length <= 2) return profiles

  const palettes = profiles.map((p) => paletteOf(p))
  const reps = palettes.map((p) => p[0]?.lab || { L: 0, a: 0, b: 0 })
  const remaining = new Set(profiles.map((_, i) => i))

  // Deterministic start point by representative lightness.
  let current = profiles
    .map((_, i) => i)
    .sort((ia, ib) => {
      const a = reps[ia]
      const b = reps[ib]
      if (a.L !== b.L) return a.L - b.L
      if (a.a !== b.a) return a.a - b.a
      return a.b - b.b
    })[0]

  const orderedIdx = [current]
  remaining.delete(current)

  while (remaining.size > 0) {
    let best = -1
    let bestDist = Number.POSITIVE_INFINITY
    const currentPalette = palettes[current]

    for (const idx of remaining) {
      const d = colorDistancePalette(currentPalette, palettes[idx])
      if (d < bestDist) {
        bestDist = d
        best = idx
      }
    }

    current = best
    orderedIdx.push(current)
    remaining.delete(current)
  }

  const optimizedIdx = twoOptImproveOrder(orderedIdx, (x, y) => colorDistancePalette(palettes[x], palettes[y]), profiles.length)
  return optimizedIdx.map((i) => profiles[i])
}

function twoOptImproveOrder(order, distanceFn, profileCount) {
  const n = order.length
  if (n < 6) return order

  // Keep runtime snappy for large sets.
  const windowSize = profileCount > 350 ? 24 : 44
  const maxPasses = profileCount > 350 ? 1 : 2
  const out = order.slice()
  const startMs = Date.now()
  const timeBudgetMs = profileCount > 350 ? 200 : 260

  const segCost = (i, k) => {
    const a = out[i - 1]
    const b = out[i]
    const c = out[k]
    const d = out[k + 1]
    const before = distanceFn(a, b) + distanceFn(c, d)
    const after = distanceFn(a, c) + distanceFn(b, d)
    return before - after
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false

    for (let i = 1; i < n - 2; i++) {
      const kMax = Math.min(n - 2, i + windowSize)
      let bestK = -1
      let bestGain = 0

      for (let k = i + 1; k <= kMax; k++) {
        const gain = segCost(i, k)
        if (gain > bestGain) {
          bestGain = gain
          bestK = k
        }
      }

      if (bestK !== -1) {
        let left = i
        let right = bestK
        while (left < right) {
          const tmp = out[left]
          out[left] = out[right]
          out[right] = tmp
          left++
          right--
        }
        improved = true
      }

      if ((i % 10 === 0) && (Date.now() - startMs > timeBudgetMs)) return out
    }

    if (!improved) break
  }

  return out
}

function sortedColorProfiles() {
  const list = [...state.colorLab.profiles]
  if (state.colorLab.sortMode === 'nearest') return nearestNeighborOrder(list)
  if (state.colorLab.sortMode === 'nearest-palette') return nearestNeighborPaletteOrder(list)

  list.sort((a, b) => {
    const ah = hslOf(a)
    const bh = hslOf(b)
    if (state.colorLab.sortMode === 'saturation') {
      if (bh.s !== ah.s) return bh.s - ah.s
      if (ah.h !== bh.h) return ah.h - bh.h
      return ah.l - bh.l
    }
    if (state.colorLab.sortMode === 'lightness') {
      if (ah.l !== bh.l) return ah.l - bh.l
      if (ah.h !== bh.h) return ah.h - bh.h
      return bh.s - ah.s
    }
    if (Math.floor(ah.h / 30) !== Math.floor(bh.h / 30)) return Math.floor(ah.h / 30) - Math.floor(bh.h / 30)
    if (bh.s !== ah.s) return bh.s - ah.s
    return ah.l - bh.l
  })
  return list
}

function masonryColumnCount() {
  if (typeof window === 'undefined') return 4
  if (window.innerWidth <= 768) return 2
  if (window.innerWidth <= 1200) return 3
  return 4
}

function renderMasonry(sorted) {
  const cols = Array.from({ length: masonryColumnCount() }, () => [])
  for (let i = 0; i < sorted.length; i++) {
    cols[i % cols.length].push(sorted[i])
  }

  return `
    <div class="color-masonry">
      ${cols.map(col => `
        <div class="color-masonry-col">
          ${col.map(renderColorCard).join('')}
        </div>
      `).join('')}
    </div>
  `
}

function renderColorCard(profile) {
  const hsl = hslOf(profile)
  const avg = rgbOf(profile, 'average')
  const vibrant = rgbOf(profile, 'vibrant')
  const dominant = rgbOf(profile, 'dominant')
  const masonry = state.colorLab.layout === 'masonry'
  const hslText = `HSL(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`
  return `
    <div class="color-card">
      <div class="color-thumb-wrap ${masonry ? 'masonry' : ''}">
        <img src="${colorPreviewSrc(profile.filepath, masonry)}" loading="lazy" class="color-thumb ${masonry ? 'masonry' : ''}" />
        <div class="color-overlay">
          <span class="color-hsl-pill">${hslText}</span>
        </div>
      </div>
      <div class="color-card-meta">
        <div class="color-title" title="${esc(profile.name)}">${esc(profile.name)}</div>
        <div class="color-swatches">
          <span class="color-swatch" title="Average" style="background: rgb(${avg.r}, ${avg.g}, ${avg.b})"></span>
          <span class="color-swatch" title="Vibrant" style="background: rgb(${vibrant.r}, ${vibrant.g}, ${vibrant.b})"></span>
          <span class="color-swatch" title="Dominant" style="background: rgb(${dominant.r}, ${dominant.g}, ${dominant.b})"></span>
        </div>
      </div>
    </div>
  `
}

function renderColorLab(container) {
  const total = state.colorLab.profiles.length
  const progress = state.colorLab.progress
  const masonry = state.colorLab.layout === 'masonry'
  const sorted = sortedColorProfiles()
  const groups = masonry ? [] : groupProfilesByHue(sorted)

  container.innerHTML = `
    <div>
      <div class="step-header">
        <h2>Color Lab</h2>
        <p>Compute HSL locally in your browser and cluster similar-color images together</p>
      </div>

      <div class="panel">
        <h3>Analyze Folder</h3>
        <div class="dir-row">
          <input
            id="color-dir-input"
            type="text"
            placeholder="/Users/you/Photos/batch001"
            value="${esc(state.colorLab.sourceDir)}"
            spellcheck="false"
          />
          <button class="btn-primary" onclick="loadColorLabPhotos()">Analyze</button>
          <button class="btn-secondary" onclick="loadColorLabPhotos({ forceRecompute: true })">Recompute</button>
        </div>
        <div class="controls-row">
          <label>
            <span class="field-label">Profile Method</span>
            <select onchange="setColorProfileMethod(this.value)">
              <option value="average" ${state.colorLab.profileMethod === 'average' ? 'selected' : ''}>Average</option>
              <option value="vibrant" ${state.colorLab.profileMethod === 'vibrant' ? 'selected' : ''}>Vibrant weighted</option>
              <option value="dominant" ${state.colorLab.profileMethod === 'dominant' ? 'selected' : ''}>Dominant bucket</option>
            </select>
          </label>
          <label>
            <span class="field-label">Sort</span>
            <select onchange="setColorSortMode(this.value)">
              <option value="hue" ${state.colorLab.sortMode === 'hue' ? 'selected' : ''}>Hue bands</option>
              <option value="nearest" ${state.colorLab.sortMode === 'nearest' ? 'selected' : ''}>Nearest neighbor (LAB + 2-opt)</option>
              <option value="nearest-palette" ${state.colorLab.sortMode === 'nearest-palette' ? 'selected' : ''}>Nearest neighbor (Palette)</option>
              <option value="saturation" ${state.colorLab.sortMode === 'saturation' ? 'selected' : ''}>Saturation</option>
              <option value="lightness" ${state.colorLab.sortMode === 'lightness' ? 'selected' : ''}>Lightness</option>
            </select>
          </label>
          <label>
            <span class="field-label">Layout</span>
            <select onchange="setColorLayout(this.value)">
              <option value="grid" ${state.colorLab.layout === 'grid' ? 'selected' : ''}>Grid</option>
              <option value="masonry" ${state.colorLab.layout === 'masonry' ? 'selected' : ''}>Masonry</option>
            </select>
          </label>
          <button class="btn-ghost" onclick="clearColorLabCache()">Clear Browser Cache</button>
        </div>
        ${state.colorLab.loading ? `<p class="hint" style="margin-top:10px">Analyzing locally… ${progress.done}/${progress.total}</p>` : ''}
        ${total > 0 ? `<p class="hint" style="margin-top:10px">${total} images analyzed · cache stored in this browser</p>` : ''}
        ${state.colorLab.errors.length > 0 ? `<p class="hint" style="margin-top:10px;color:var(--warning)">${state.colorLab.errors.length} file(s) failed to analyze</p>` : ''}
      </div>

      ${masonry
        ? (sorted.length > 0
          ? renderMasonry(sorted)
          : `<div class="panel"><p class="hint">No color profiles yet. Pick a folder and click Analyze.</p></div>`)
        : (groups.length > 0
          ? groups.map(group => `
              <div class="color-group">
                <div class="color-group-title">${hueLabel(group.idx)} • ${group.items.length}</div>
                <div class="color-grid">
                  ${group.items.map(renderColorCard).join('')}
                </div>
              </div>
            `).join('')
          : `<div class="panel"><p class="hint">No color profiles yet. Pick a folder and click Analyze.</p></div>`)}
    </div>
  `

  const input = document.getElementById('color-dir-input')
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') loadColorLabPhotos() })
}

// ── Library ───────────────────────────────────────────────────────────────────
async function showLibrary() {
  const modal = document.getElementById('library-modal')
  modal.style.display = 'flex'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>Photo Library — data/photos.json</h3>
        <button class="modal-close" onclick="closeLibrary()">✕</button>
      </div>
      <div class="modal-body" id="lib-body">
        <p style="color:var(--text-muted)">Loading…</p>
      </div>
    </div>
  `

  try {
    const photos = await api('/api/library')
    const body = document.getElementById('lib-body')

    if (photos.length === 0) {
      body.innerHTML = '<p style="color:var(--text-muted)">No photos in library yet.</p>'
      return
    }

    body.innerHTML = `
      <p class="library-count">${photos.length} photos in library</p>
      <div class="library-grid">
        ${photos.map(p => `
          <div class="lib-card" id="lib-${p.id}">
            <img src="${esc(p.src)}" alt="${esc(p.title)}" loading="lazy" onerror="this.style.opacity='0.2'" />
            <div class="lib-info">
              <span class="lib-title">${esc(p.title)}</span>
              <div class="lib-tags">${(p.tags || [p.category]).filter(Boolean).map(t => `<span class="lib-tag">${esc(t)}</span>`).join('')}</div>
              <button class="btn-danger" onclick="deleteLibPhoto('${p.id}')">Remove</button>
            </div>
          </div>
        `).join('')}
      </div>
    `
  } catch (err) {
    document.getElementById('lib-body').innerHTML = `<p style="color:var(--error)">${esc(err.message)}</p>`
  }
}

async function deleteLibPhoto(id) {
  if (!confirm('Remove from library? (Does not delete from S3)')) return
  try {
    await api(`/api/library/${id}`, { method: 'DELETE' })
    document.getElementById(`lib-${id}`)?.remove()
    toast('Removed from library', 'success')
  } catch (err) {
    toast('Delete failed: ' + err.message)
  }
}

function closeLibrary() {
  const modal = document.getElementById('library-modal')
  if (modal) modal.style.display = 'none'
}

document.addEventListener('click', e => {
  const modal = document.getElementById('library-modal')
  if (e.target === modal) closeLibrary()
})

// ── Render ────────────────────────────────────────────────────────────────────
// ── Embeddings view ────────────────────────────────────────────────────────────

const embState = {
  loading: false,
  entries: [],
  updatedAt: null,
  error: null,
}

async function loadEmbeddings() {
  const { bucket, prefix, region } = state.s3Config
  embState.loading = true
  embState.error = null
  renderEmbeddings(document.getElementById('main-content'))

  try {
    const params = new URLSearchParams({ bucket, prefix, region })
    const data = await api(`/api/embeddings?${params}`)
    embState.entries = data.entries || []
    embState.updatedAt = data.updatedAt || null
  } catch (err) {
    embState.error = err.message
  } finally {
    embState.loading = false
    renderEmbeddings(document.getElementById('main-content'))
  }
}

async function deleteEmbedding(bname) {
  if (!confirm(`Remove "${bname}" from embeddings and manifest?\n\nThis removes it from search and the portfolio gallery.`)) return
  const { bucket, prefix, region } = state.s3Config
  const params = new URLSearchParams({ bucket, prefix, region })

  const card = document.getElementById(`emb-card-${bname}`)
  if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none' }

  try {
    await api(`/api/embeddings/${encodeURIComponent(bname)}?${params}`, { method: 'DELETE' })
    embState.entries = embState.entries.filter(e => e.bname !== bname)
    showToast(`Removed ${bname}`, 'success')
    renderEmbeddings(document.getElementById('main-content'))
  } catch (err) {
    showToast(err.message, 'error')
    if (card) { card.style.opacity = ''; card.style.pointerEvents = '' }
  }
}

function renderEmbeddings(container) {
  const { bucket, prefix } = state.s3Config
  const { loading, entries, updatedAt, error } = embState

  let inner = ''

  if (loading) {
    inner = `<div style="text-align:center;padding:80px;color:var(--text-muted)">Loading embeddings…</div>`
  } else if (error) {
    inner = `<div style="text-align:center;padding:80px;color:var(--error)">${esc(error)}</div>`
  } else if (entries.length === 0 && embState.updatedAt === null) {
    inner = `
      <div style="text-align:center;padding:80px">
        <p style="color:var(--text-muted);margin-bottom:20px">Load embeddings from S3 to inspect them.</p>
        <button class="btn-primary" onclick="loadEmbeddings()">Load from S3</button>
      </div>`
  } else if (entries.length === 0) {
    inner = `<div style="text-align:center;padding:80px;color:var(--text-muted)">No embedding entries found.</div>`
  } else {
    const cards = entries.map(e => {
      const seed = e.textContext ? esc(e.textContext) : '<em style="color:var(--text-dim)">unknown (embedded before tracking)</em>'
      const when = e.embeddedAt ? new Date(e.embeddedAt).toLocaleString() : '<span style="color:var(--text-dim)">—</span>'
      const thumbEl = e.thumb
        ? `<img src="${esc(e.thumb)}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;border-radius:var(--radius-sm) var(--radius-sm) 0 0;background:#111" onerror="this.style.opacity='0.2'" />`
        : `<div style="width:100%;aspect-ratio:1;background:var(--surface-2);border-radius:var(--radius-sm) var(--radius-sm) 0 0;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:11px">no thumb</div>`
      return `
        <div id="emb-card-${esc(e.bname)}" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;transition:opacity 0.2s">
          ${thumbEl}
          <div style="padding:12px;flex:1;display:flex;flex-direction:column;gap:6px">
            <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.bname)}">${esc(e.bname)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(e.albumName || e.album || '—')}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              <span style="color:var(--text-dim);display:block;margin-bottom:2px">seed</span>
              <span style="word-break:break-word;line-height:1.4">${seed}</span>
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:auto;padding-top:6px;border-top:1px solid var(--border)">${when}</div>
            <button onclick="deleteEmbedding('${esc(e.bname)}')" style="margin-top:6px;background:var(--error-dim);border:1px solid var(--error-border);color:var(--error);border-radius:var(--radius-sm);padding:5px 10px;font-size:11px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='rgba(255,68,68,0.2)'" onmouseout="this.style.background='var(--error-dim)'">Remove everywhere</button>
          </div>
        </div>`
    }).join('')

    const ts = updatedAt ? `<span style="color:var(--text-dim)">Last updated: ${new Date(updatedAt).toLocaleString()}</span>` : ''
    inner = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div style="color:var(--text-muted)">${entries.length} embedding${entries.length !== 1 ? 's' : ''} &nbsp;${ts}</div>
        <button class="btn-ghost" onclick="loadEmbeddings()">↻ Refresh</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">${cards}</div>`
  }

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:32px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px">
        <h2 style="font-size:20px;font-weight:700">Embeddings</h2>
        ${entries.length === 0 && !loading ? '' : `<button class="btn-primary" onclick="loadEmbeddings()">Load / Refresh</button>`}
      </div>
      ${inner}
    </div>`
}

// ── Search Lab ────────────────────────────────────────────────────────────────

const searchLabState = {
  query: '',
  top: 8,
  loading: false,
  results: null,   // { query, methods: { titan: [...], 'clip-vitb32': [...] } }
  error: null,
  indices: [],     // [{ method, available, count }]
  imageCount: 0,
}

async function loadSearchIndices() {
  try {
    const data = await api('/api/search-indices')
    searchLabState.indices = data.indices || []
    searchLabState.imageCount = data.imageCount || 0
    renderSearchLab(document.getElementById('main-content'))
  } catch (e) {
    searchLabState.indices = []
  }
}

async function runSearchCompare() {
  const q = searchLabState.query.trim()
  if (!q) return
  searchLabState.loading = true
  searchLabState.error = null
  searchLabState.results = null
  renderSearchLab(document.getElementById('main-content'))

  try {
    const data = await api('/api/search-compare', {
      method: 'POST',
      body: { query: q, top: searchLabState.top },
    })
    searchLabState.results = data
  } catch (e) {
    searchLabState.error = e.message
  } finally {
    searchLabState.loading = false
    renderSearchLab(document.getElementById('main-content'))
  }
}

function renderSearchLab(container) {
  const { query, loading, results, error, indices, imageCount, top } = searchLabState

  const availableMethods = indices.filter(i => i.available)

  // ── Status bar ──
  const statusPills = indices.map(idx => {
    if (idx.available) {
      return `<span style="display:inline-flex;align-items:center;gap:5px;background:var(--success-dim);border:1px solid var(--success-border);color:var(--success);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--success);flex-shrink:0"></span>
        ${esc(idx.method)} &nbsp;<span style="opacity:0.7;font-weight:400">${idx.count} imgs</span>
      </span>`
    }
    return `<span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-dim);border-radius:20px;padding:3px 10px;font-size:11px">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--text-dim);flex-shrink:0"></span>
      ${esc(idx.method)} &nbsp;<span style="opacity:0.6">not indexed</span>
    </span>`
  }).join('')

  const cacheNote = imageCount > 0
    ? `<span style="color:var(--text-dim);font-size:11px">${imageCount} thumbnails cached</span>`
    : `<span style="color:var(--warning);font-size:11px">No thumbnails — run: python compare.py --download</span>`

  // ── Results columns ──
  let resultsHtml = ''
  if (loading) {
    resultsHtml = `<div style="text-align:center;padding:60px;color:var(--text-muted)">
      Running search… <span style="color:var(--text-dim);font-size:12px">(CLIP model load takes ~3s)</span>
    </div>`
  } else if (error) {
    resultsHtml = `<div style="padding:20px;background:var(--error-dim);border:1px solid var(--error-border);border-radius:var(--radius);color:var(--error);font-size:13px;white-space:pre-wrap">${esc(error)}</div>`
  } else if (results) {
    const methodNames = Object.keys(results.methods)
    if (methodNames.length === 0) {
      resultsHtml = `<div style="text-align:center;padding:60px;color:var(--text-muted)">No methods are indexed yet.</div>`
    } else {
      const cols = methodNames.map(method => {
        const entries = results.methods[method]

        if (entries.error) {
          return `<div style="flex:1;min-width:260px">
            <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">${esc(method)}</div>
            <div style="color:var(--error);font-size:12px">${esc(entries.error)}</div>
          </div>`
        }

        const topScore  = entries[0]?.score ?? 0
        const botScore  = entries[entries.length - 1]?.score ?? 0
        const scoreRange = topScore - botScore

        const cards = entries.map(e => {
          const pct = topScore > 0 ? e.score / topScore : 0
          const barW = Math.round(pct * 100)
          const scoreColor = e.rank === 1 ? 'var(--success)' : e.rank <= 3 ? 'var(--primary)' : 'var(--text-muted)'
          const imgSrc = `/api/cache-images/${encodeURIComponent(e.file)}`
          return `
            <div style="display:flex;gap:10px;align-items:center;padding:8px;background:var(--surface-2);border-radius:var(--radius-sm);border:1px solid var(--border)">
              <img src="${imgSrc}" loading="lazy"
                style="width:56px;height:56px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#111"
                onerror="this.style.opacity='0.15'" />
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(e.file)}">${esc(e.file)}</div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
                  <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${barW}%;background:${scoreColor};border-radius:2px;transition:width 0.3s"></div>
                  </div>
                  <span style="font-size:11px;font-weight:700;color:${scoreColor};flex-shrink:0;font-variant-numeric:tabular-nums">${e.score.toFixed(4)}</span>
                </div>
              </div>
            </div>`
        }).join('')

        const discrimination = scoreRange.toFixed(4)
        return `
          <div style="flex:1;min-width:260px;max-width:480px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
              <span style="font-size:12px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:0.05em">${esc(method)}</span>
              <span style="font-size:10px;color:var(--text-dim)">spread: ${discrimination}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
          </div>`
      }).join('')

      resultsHtml = `
        <div style="margin-top:4px;padding:10px 14px;background:var(--surface-2);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Score bar = relative to top result per method &nbsp;·&nbsp; <span style="color:var(--text-dim)">spread</span> = top1 − rank5 (higher = better discrimination)
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:20px">${cols}</div>`
    }
  }

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">Search Lab</h2>
        <p style="color:var(--text-muted);font-size:13px">Compare embedding methods side-by-side using locally indexed images.</p>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:20px">
        ${statusPills}
        ${cacheNote}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input
          id="sl-query"
          type="text"
          placeholder="cherry blossoms at golden hour…"
          value="${esc(query)}"
          style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;outline:none"
          onfocus="this.style.borderColor='var(--primary-border)'"
          onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter'){searchLabState.query=this.value;runSearchCompare()}"
        />
        <select id="sl-top"
          style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 10px;color:var(--text);font-size:13px"
          onchange="searchLabState.top=+this.value">
          ${[5,8,12,20].map(n => `<option value="${n}" ${n === top ? 'selected' : ''}>Top ${n}</option>`).join('')}
        </select>
        <button class="btn-primary" onclick="searchLabState.query=document.getElementById('sl-query').value;runSearchCompare()" ${loading || availableMethods.length === 0 ? 'disabled' : ''}>
          ${loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      ${availableMethods.length === 0 ? `
        <div style="padding:16px;background:var(--surface-2);border-radius:var(--radius-sm);border:1px solid var(--border);color:var(--text-muted);font-size:12px">
          No indices found. In the playground directory, run:<br/>
          <code style="color:var(--primary);font-size:11px">python compare.py --download &amp;&amp; python compare.py --index clip-vitb32</code>
        </div>` : ''}

      ${resultsHtml}
    </div>`

  // Re-bind query state on input so it persists across renders
  const inp = document.getElementById('sl-query')
  if (inp) inp.addEventListener('input', e => { searchLabState.query = e.target.value })
}

// ── Pipeline Dashboard ────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'resize',   label: 'Resize',   desc: 'thumb / medium / large → S3 derived/' },
  { key: 'colors',   label: 'Colors',   desc: 'CIELAB palette → manifest colorMetadata' },
  { key: 'describe', label: 'Describe', desc: 'Claude Haiku → manifest description' },
  { key: 'embed',    label: 'Embed',    desc: 'Nova + description → embeddings.json' },
  { key: 'title',    label: 'Title',    desc: 'Claude Haiku → vibey title (admin-side)' },
]

// Steps that can be triggered via Step Functions (not title — that's admin-side)
const TRIGGERABLE_STEPS = PIPELINE_STEPS.filter(s => s.key !== 'title')

const pipelineState = {
  loading: false,
  photos: [],        // [{ id, bname, thumb, albumName, album, resize, colors, describe, embed, title }]
  error: null,
  filter: 'all',     // 'all' | 'incomplete' | step key
  executions: {},    // { bname: { executionArn, status, startAt } }
  runningAll: false,
  runAllProgress: { started: 0, total: 0 },
  pollTimer: null,
  testPanel: { open: false, step: 'describe', bname: '', album: '', running: false, result: null },
  detailBname: '',
  selected: new Set(),
}

async function loadPipelineStatus() {
  pipelineState.loading = true
  pipelineState.error = null
  renderPipeline(document.getElementById('main-content'))

  try {
    const s3Params = new URLSearchParams(state.s3Config)
    const [photos, embData, execData] = await Promise.all([
      api(`/api/s3-manifest?${s3Params}`),
      api(`/api/embeddings?${s3Params}`).catch(() => ({ entries: [] })),
      api('/api/process/executions?status=RUNNING').catch(() => ({ executions: [] })),
    ])

    const embEntries = embData.entries || []
    const embSet = new Set(embEntries.map(e => e.bname))
    const embByBname = new Map(embEntries.map(e => [e.bname, e]))

    pipelineState.photos = photos.map(p => {
      const url = p.original || p.src || ''
      const fname = url.split('/').pop() || ''
      const bn = fname.replace(/\.[^.]+$/, '')
      const emb = embByBname.get(bn) || null
      return {
        id: p.id,
        bname: bn,
        filename: fname,
        thumb: p.thumb || null,
        album: p.album || '',
        albumName: p.albumName || p.album || '',
        resize:   !!(p.thumb && p.medium && p.large),
        colors:   !!(p.colorMetadata && p.colorMetadata.palette),
        describe: !!(p.description),
        embed:    embSet.has(bn),
        title:    !!p.title,
        manifest: p,
        embedding: emb,
      }
    })
    if (pipelineState.detailBname && !pipelineState.photos.some(p => p.bname === pipelineState.detailBname)) {
      pipelineState.detailBname = ''
    }

    // Mark any currently running executions
    for (const ex of (execData.executions || [])) {
      // Parse bname from execution name if possible
      const name = ex.name || ''
      // Execution names are auto-generated, but we track via our own state
    }

    // If there are running executions, start polling
    if (execData.executions?.length > 0) startPipelinePolling()

  } catch (e) {
    pipelineState.error = e.message
  } finally {
    pipelineState.loading = false
    renderPipeline(document.getElementById('main-content'))
  }
}

function togglePipelineSelection(bname) {
  if (pipelineState.selected.has(bname)) pipelineState.selected.delete(bname)
  else pipelineState.selected.add(bname)
  renderPipeline(document.getElementById('main-content'))
}

function togglePipelineSelectAll() {
  const { photos, filter, selected } = pipelineState
  const filtered = getFilteredPhotos(photos, filter)
  const allSelected = filtered.every(p => selected.has(p.bname))
  if (allSelected) filtered.forEach(p => selected.delete(p.bname))
  else filtered.forEach(p => selected.add(p.bname))
  renderPipeline(document.getElementById('main-content'))
}

async function deleteSelectedEmbeddings() {
  const bnames = [...pipelineState.selected]
  if (!bnames.length) return
  if (!confirm(`Clear embeddings for ${bnames.length} photo${bnames.length > 1 ? 's' : ''}? They will need to be re-embedded.`)) return
  const s3Params = new URLSearchParams(state.s3Config)
  await api(`/api/embeddings/bulk?${s3Params}`, { method: 'DELETE', body: { bnames } })
  pipelineState.selected.clear()
  await loadPipelineStatus()
}

async function deleteAllEmbeddings() {
  if (!confirm('Clear ALL embeddings? Every photo will need to be re-embedded.')) return
  const s3Params = new URLSearchParams(state.s3Config)
  await api(`/api/embeddings/bulk?${s3Params}`, { method: 'DELETE', body: { all: true } })
  pipelineState.selected.clear()
  await loadPipelineStatus()
}

function getFilteredPhotos(photos, filter) {
  if (filter === 'all') return photos
  if (filter === 'incomplete') return photos.filter(p => PIPELINE_STEPS.some(s => !p[s.key]))
  return photos.filter(p => !p[filter])
}

async function triggerPipelinePhoto(bname, album, startAt) {
  const photo = pipelineState.photos.find(p => p.bname === bname)
  const btn = document.querySelector(`[data-trigger-bname="${bname}"]`)
  if (btn) { btn.disabled = true; btn.textContent = '...' }

  try {
    const result = await api('/api/process/photo', {
      method: 'POST',
      body: {
        bname,
        album,
        filename: photo?.filename,
        startAt: startAt || undefined,
        bucket: state.s3Config.bucket,
        prefix: state.s3Config.prefix,
        region: state.s3Config.region,
      },
    })
    pipelineState.executions[bname] = {
      executionArn: result.executionArn,
      status: 'RUNNING',
      startAt: startAt || 'resize',
    }
    toast(`Started pipeline for ${bname}` + (startAt ? ` from ${startAt}` : ''), 'success')
    startPipelinePolling()
    renderPipeline(document.getElementById('main-content'))
  } catch (e) {
    toast(`Failed to trigger ${bname}: ${e.message}`)
    if (btn) { btn.disabled = false; btn.textContent = 'Run' }
  }
}

async function triggerPipelineAll(startAt) {
  if (pipelineState.runningAll) return
  const targets = startAt
    ? pipelineState.photos.filter(p => !p[startAt])
    : [...pipelineState.photos]
  const missing = targets.length
  if (!confirm(`Run pipeline for ${missing} photos${startAt ? ` from "${startAt}"` : ''}?`)) return

  pipelineState.runningAll = true
  pipelineState.runAllProgress = { started: 0, total: missing }
  renderPipeline(document.getElementById('main-content'))

  try {
    const result = await api('/api/process/all', {
      method: 'POST',
      body: {
        startAt: startAt || undefined,
        bucket: state.s3Config.bucket,
        prefix: state.s3Config.prefix,
        region: state.s3Config.region,
        photos: targets.map(p => ({
          bname: p.bname,
          album: p.album,
          filename: p.filename,
        })),
      },
    })
    pipelineState.runningAll = false
    pipelineState.runAllProgress = { started: result.started, total: result.total }

    // Track all executions
    for (const r of (result.results || [])) {
      if (r.executionArn) {
        pipelineState.executions[r.bname] = {
          executionArn: r.executionArn,
          status: 'RUNNING',
          startAt: startAt || 'resize',
        }
      }
    }

    toast(`Started ${result.started} executions` + (result.failed ? `, ${result.failed} failed` : ''), 'success')
    startPipelinePolling()
  } catch (e) {
    pipelineState.runningAll = false
    toast(`Batch trigger failed: ${e.message}`)
  }
  renderPipeline(document.getElementById('main-content'))
}

function startPipelinePolling() {
  if (pipelineState.pollTimer) return
  pipelineState.pollTimer = setInterval(async () => {
    const running = Object.entries(pipelineState.executions).filter(([, ex]) => ex.status === 'RUNNING')
    if (running.length === 0) {
      clearInterval(pipelineState.pollTimer)
      pipelineState.pollTimer = null
      // Final refresh to get updated completion status
      loadPipelineStatus()
      return
    }

    // Poll up to 10 at a time to avoid hammering
    const batch = running.slice(0, 10)
    for (const [bname, ex] of batch) {
      try {
        const result = await api(`/api/process/status?executionArn=${encodeURIComponent(ex.executionArn)}`)
        pipelineState.executions[bname].status = result.status
      } catch {
        // Ignore poll errors
      }
    }

    // Update running count display
    const stillRunning = Object.values(pipelineState.executions).filter(e => e.status === 'RUNNING').length
    const counterEl = document.getElementById('pipeline-running-count')
    if (counterEl) {
      if (stillRunning > 0) {
        counterEl.textContent = `${stillRunning} running`
        counterEl.style.display = ''
      } else {
        counterEl.style.display = 'none'
      }
    }

    // If all done, stop polling and refresh
    if (stillRunning === 0) {
      clearInterval(pipelineState.pollTimer)
      pipelineState.pollTimer = null
      pipelineState.executions = {}
      loadPipelineStatus()
    }
  }, 5000)
}

function openPipelinePhotoDetail(bname) {
  pipelineState.detailBname = bname || ''
  renderPipeline(document.getElementById('main-content'))
}

function closePipelinePhotoDetail() {
  pipelineState.detailBname = ''
  renderPipeline(document.getElementById('main-content'))
}

function buildPipelineDetailPanel() {
  const photo = pipelineState.photos.find(p => p.bname === pipelineState.detailBname)
  if (!photo) return ''

  const manifestJson = JSON.stringify(photo.manifest || null, null, 2)
  const embeddingJson = JSON.stringify(photo.embedding || null, null, 2)
  const statusChips = PIPELINE_STEPS.map(step => {
    const done = !!photo[step.key]
    return `<span style="font-size:10px;font-weight:600;padding:4px 8px;border-radius:999px;border:1px solid ${done ? 'var(--success)' : 'var(--border)'};color:${done ? 'var(--success)' : 'var(--text-dim)'};background:${done ? 'rgba(72, 187, 120, 0.08)' : 'var(--surface-2)'}">${step.label}: ${done ? 'yes' : 'no'}</span>`
  }).join('')

  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-top:16px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(photo.bname)}</div>
          <div style="font-size:11px;color:var(--text-dim)">${esc(photo.albumName || photo.album || '')}</div>
        </div>
        <button onclick="closePipelinePhotoDetail()" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px;padding:0 4px">x</button>
      </div>
      <div style="padding:16px;display:grid;grid-template-columns:minmax(220px,320px) minmax(0,1fr);gap:16px;align-items:start">
        <div>
          ${photo.thumb ? `<img src="${esc(photo.thumb)}" style="width:100%;max-width:320px;border-radius:8px;display:block;background:#111" onerror="this.style.opacity='0.15'" />` : `<div style="width:100%;aspect-ratio:1;background:var(--surface-2);border-radius:8px"></div>`}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${statusChips}</div>
        </div>
        <div style="display:grid;gap:16px">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Manifest</div>
            <pre style="font-size:11px;color:var(--text);background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);overflow:auto;max-height:360px;margin:0;white-space:pre-wrap;word-break:break-word">${esc(manifestJson)}</pre>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Embedding Entry</div>
            <pre style="font-size:11px;color:var(--text);background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);overflow:auto;max-height:360px;margin:0;white-space:pre-wrap;word-break:break-word">${esc(embeddingJson)}</pre>
          </div>
        </div>
      </div>
    </div>`
}

function renderPipeline(container) {
  const { loading, photos, error, filter, executions, runningAll, selected } = pipelineState

  if (loading) {
    container.innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-muted)">Loading pipeline status...</div>`
    return
  }
  if (error) {
    container.innerHTML = `<div style="text-align:center;padding:80px;color:var(--error)">${esc(error)}</div>`
    return
  }
  if (photos.length === 0) {
    container.innerHTML = `
      <div style="max-width:1200px;margin:0 auto;padding:32px 24px;text-align:center">
        <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Pipeline Dashboard</h2>
        <button class="btn-primary" onclick="loadPipelineStatus()">Load Status</button>
      </div>`
    return
  }

  const runningCount = Object.values(executions).filter(e => e.status === 'RUNNING').length

  // ── Compute stats per step ──
  const stats = {}
  for (const s of PIPELINE_STEPS) {
    const done = photos.filter(p => p[s.key]).length
    stats[s.key] = { done, total: photos.length, pct: Math.round((done / photos.length) * 100) }
  }

  // ── Pipeline flow diagram with trigger buttons ──
  const stageCards = PIPELINE_STEPS.map((s, i) => {
    const st = stats[s.key]
    const pct = st.pct
    const barColor = pct === 100 ? 'var(--success)' : pct > 0 ? 'var(--primary)' : 'var(--text-dim)'
    const bgColor = pct === 100 ? 'var(--success-dim)' : pct > 0 ? 'var(--primary-dim)' : 'var(--surface-2)'
    const borderColor = pct === 100 ? 'var(--success-border)' : pct > 0 ? 'var(--primary-border)' : 'var(--border)'
    const arrow = i < PIPELINE_STEPS.length - 1
      ? `<div style="display:flex;align-items:center;padding:0 4px;color:var(--text-dim);font-size:18px;flex-shrink:0">→</div>`
      : ''
    const isLambda = s.key !== 'title'
    const badge = isLambda
      ? `<span style="font-size:9px;color:var(--text-dim);background:rgba(255,255,255,0.06);border-radius:3px;padding:1px 5px;letter-spacing:0.05em">LAMBDA</span>`
      : `<span style="font-size:9px;color:var(--primary);background:var(--primary-dim);border-radius:3px;padding:1px 5px;letter-spacing:0.05em">ADMIN</span>`

    const missingCount = photos.filter(p => !p[s.key]).length
    const triggerBtn = isLambda && missingCount > 0
      ? `<button onclick="event.stopPropagation();triggerPipelineAll('${s.key}')"
          style="margin-top:8px;width:100%;padding:4px 8px;font-size:10px;font-weight:600;cursor:pointer;
            background:var(--primary-dim);border:1px solid var(--primary-border);color:var(--primary);
            border-radius:var(--radius-sm);transition:all 0.15s"
          onmouseover="this.style.background='var(--primary)';this.style.color='#fff'"
          onmouseout="this.style.background='var(--primary-dim)';this.style.color='var(--primary)'"
          ${runningAll ? 'disabled' : ''}>
          Run ${missingCount} missing
        </button>`
      : ''

    return `
      <div style="display:flex;align-items:stretch;flex:1;min-width:0">
        <div onclick="pipelineState.filter='${s.key}';renderPipeline(document.getElementById('main-content'))"
          style="flex:1;min-width:120px;background:${bgColor};border:1px solid ${borderColor};border-radius:var(--radius);padding:14px;cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;${filter === s.key ? 'box-shadow:0 0 0 2px var(--primary);' : ''}"
          onmouseover="this.style.borderColor='var(--primary-border)'" onmouseout="this.style.borderColor='${borderColor}'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;color:var(--text)">${s.label}</span>
            ${badge}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:10px;line-height:1.3">${s.desc}</div>
          <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:6px">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.5s"></div>
          </div>
          <div style="font-size:12px;font-weight:600;color:${barColor}">${st.done}/${st.total} <span style="font-weight:400;color:var(--text-dim)">(${pct}%)</span></div>
          ${triggerBtn}
        </div>
        ${arrow}
      </div>`
  }).join('')

  // ── Trigger bar ──
  const runAllBtn = runningAll
    ? `<button disabled style="padding:6px 14px;font-size:11px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-dim);border-radius:var(--radius-sm);cursor:not-allowed">
        Running...
      </button>`
    : `<div style="position:relative;display:inline-block">
        <button onclick="document.getElementById('run-all-dropdown').style.display=document.getElementById('run-all-dropdown').style.display==='block'?'none':'block'"
          style="padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;background:var(--primary);border:none;color:#fff;border-radius:var(--radius-sm);transition:all 0.15s"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          Run All...
        </button>
        <div id="run-all-dropdown" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;z-index:100;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
          <button onclick="document.getElementById('run-all-dropdown').style.display='none';triggerPipelineAll()"
            style="display:block;width:100%;text-align:left;padding:8px 12px;font-size:11px;cursor:pointer;background:none;border:none;color:var(--text);border-radius:var(--radius-sm)"
            onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
            Full pipeline (all steps)
          </button>
          ${TRIGGERABLE_STEPS.map(s => `
            <button onclick="document.getElementById('run-all-dropdown').style.display='none';triggerPipelineAll('${s.key}')"
              style="display:block;width:100%;text-align:left;padding:8px 12px;font-size:11px;cursor:pointer;background:none;border:none;color:var(--text);border-radius:var(--radius-sm)"
              onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
              From ${s.label} onward
            </button>`).join('')}
        </div>
      </div>`

  const triggerBar = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px">
      <span style="font-size:11px;color:var(--text-dim);margin-right:4px">Triggers:</span>
      <div style="display:flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 12px">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--success);flex-shrink:0"></span>
        <span style="font-size:11px;color:var(--text)">S3 Upload → auto</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 12px">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--primary);flex-shrink:0"></span>
        <span style="font-size:11px;color:var(--text)">Admin → manual retrigger</span>
      </div>
      <div style="flex:1"></div>
      <span id="pipeline-running-count" style="font-size:11px;font-weight:600;color:var(--warning);display:${runningCount > 0 ? '' : 'none'}">${runningCount} running</span>
      <button onclick="openTestPanel()"
        style="padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;background:var(--surface-2);border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm);transition:all 0.15s"
        onmouseover="this.style.borderColor='var(--warning-border, #6b5c2e)';this.style.color='var(--warning, #e8a735)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">
        Test Step
      </button>
      ${runAllBtn}
    </div>`

  // ── Filter tabs ──
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'incomplete', label: 'Incomplete' },
    ...PIPELINE_STEPS.map(s => ({ key: s.key, label: `Missing ${s.label}` })),
  ]
  const filterPills = filters.map(f => {
    const isActive = filter === f.key
    let count = photos.length
    if (f.key === 'incomplete') count = photos.filter(p => PIPELINE_STEPS.some(s => !p[s.key])).length
    else if (f.key !== 'all') count = photos.filter(p => !p[f.key]).length

    return `<button onclick="pipelineState.filter='${f.key}';renderPipeline(document.getElementById('main-content'))"
      style="background:${isActive ? 'var(--primary-dim)' : 'var(--surface-2)'};border:1px solid ${isActive ? 'var(--primary-border)' : 'var(--border)'};color:${isActive ? 'var(--primary)' : 'var(--text-muted)'};border-radius:20px;padding:4px 12px;font-size:11px;cursor:pointer;white-space:nowrap">
      ${f.label} <span style="opacity:0.6">${count}</span>
    </button>`
  }).join('')

  // ── Photo table ──
  const filtered = getFilteredPhotos(photos, filter)
  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.bname))
  const someSelected = selected.size > 0

  const bulkBar = someSelected ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm)">
      <span style="font-size:11px;color:var(--text);font-weight:600">${selected.size} selected</span>
      <div style="flex:1"></div>
      <button onclick="pipelineState.selected.clear();renderPipeline(document.getElementById('main-content'))"
        style="padding:4px 10px;font-size:11px;cursor:pointer;background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm)">
        Deselect All
      </button>
      <button onclick="deleteSelectedEmbeddings()"
        style="padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;background:none;border:1px solid var(--error-border,#7f2d2d);color:var(--error,#f87171);border-radius:var(--radius-sm)"
        onmouseover="this.style.background='rgba(248,113,113,0.1)'" onmouseout="this.style.background='none'">
        Clear Embeddings (${selected.size})
      </button>
    </div>` : ''

  const stepHeaders = PIPELINE_STEPS.map(s =>
    `<th style="text-align:center;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;padding:8px 6px">${s.label}</th>`
  ).join('')

  const rows = filtered.map(p => {
    const ex = executions[p.bname]
    const isRunning = ex && ex.status === 'RUNNING'

    const cells = PIPELINE_STEPS.map(s => {
      const done = p[s.key]
      let icon
      if (isRunning) {
        icon = done
          ? `<span style="color:var(--success);font-size:14px">●</span>`
          : `<span style="color:var(--warning);font-size:12px" class="pipeline-spin">◌</span>`
      } else {
        icon = done
          ? `<span style="color:var(--success);font-size:14px">●</span>`
          : `<span style="color:var(--text-dim);font-size:14px">○</span>`
      }
      return `<td style="text-align:center;padding:6px">${icon}</td>`
    }).join('')

    const thumbEl = p.thumb
      ? `<img src="${esc(p.thumb)}" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0;background:#111;cursor:pointer" onclick="event.stopPropagation();openPipelinePhotoDetail('${esc(p.bname)}')" onerror="this.style.opacity='0.15'" />`
      : `<div style="width:36px;height:36px;background:var(--surface-2);border-radius:4px;flex-shrink:0"></div>`

    // Per-photo trigger — dropdown for step selection
    const hasMissing = TRIGGERABLE_STEPS.some(s => !p[s.key])
    const triggerCell = isRunning
      ? `<td style="padding:6px 8px;text-align:right">
          <span style="font-size:10px;color:var(--warning);font-weight:600" class="pipeline-spin-text">Running</span>
        </td>`
      : `<td style="padding:6px 8px;text-align:right">
          <div style="position:relative;display:inline-block">
            <button data-trigger-bname="${esc(p.bname)}" onclick="event.stopPropagation();togglePhotoDropdown('${esc(p.bname)}')"
              style="padding:3px 10px;font-size:10px;font-weight:600;cursor:pointer;background:var(--surface-2);border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm);transition:all 0.15s"
              onmouseover="this.style.borderColor='var(--primary-border)';this.style.color='var(--primary)'"
              onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">
              ${hasMissing ? 'Run' : 'Retrigger'}
            </button>
            <div id="photo-dd-${esc(p.bname)}" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;z-index:100;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
              ${hasMissing ? `
                <button onclick="hidePhotoDropdowns();triggerPipelinePhoto('${esc(p.bname)}','${esc(p.album)}')"
                  style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:10px;cursor:pointer;background:none;border:none;color:var(--text);border-radius:var(--radius-sm)"
                  onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
                  Full pipeline
                </button>
                ${TRIGGERABLE_STEPS.filter(s => !p[s.key]).map(s => `
                  <button onclick="hidePhotoDropdowns();triggerPipelinePhoto('${esc(p.bname)}','${esc(p.album)}','${s.key}')"
                    style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:10px;cursor:pointer;background:none;border:none;color:var(--text);border-radius:var(--radius-sm)"
                    onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
                    From ${s.label}
                  </button>`).join('')}
              ` : `
                ${TRIGGERABLE_STEPS.map(s => `
                  <button onclick="hidePhotoDropdowns();triggerPipelinePhoto('${esc(p.bname)}','${esc(p.album)}','${s.key}')"
                    style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:10px;cursor:pointer;background:none;border:none;color:var(--text);border-radius:var(--radius-sm)"
                    onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
                    From ${s.label}
                  </button>`).join('')}
              `}
              <div style="border-top:1px solid var(--border);margin:4px 0"></div>
              ${TRIGGERABLE_STEPS.map(s => `
                <button onclick="hidePhotoDropdowns();openTestPanel('${esc(p.bname)}','${esc(p.album)}','${s.key}')"
                  style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:10px;cursor:pointer;background:none;border:none;color:var(--warning, #e8a735);border-radius:var(--radius-sm)"
                  onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='none'">
                  Test ${s.label}
                </button>`).join('')}
            </div>
          </div>
        </td>`

    const isSelected = selected.has(p.bname)
    return `
      <tr style="border-bottom:1px solid var(--border);background:${isSelected ? 'var(--primary-dim,rgba(255,107,53,0.06))' : 'transparent'}">
        <td style="padding:6px 8px 6px 12px">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="togglePipelineSelection('${esc(p.bname)}')" onclick="event.stopPropagation()" style="cursor:pointer;accent-color:var(--primary)" />
        </td>
        <td style="padding:6px 8px">
          <div style="display:flex;align-items:center;gap:8px">
            ${thumbEl}
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--text);cursor:pointer" onclick="openPipelinePhotoDetail('${esc(p.bname)}')">${esc(p.bname)}</div>
              <div style="font-size:10px;color:var(--text-dim)">${esc(p.albumName)}</div>
            </div>
          </div>
        </td>
        ${cells}
        ${triggerCell}
      </tr>`
  }).join('')

  const completePct = Math.round(photos.filter(p => PIPELINE_STEPS.every(s => p[s.key])).length / photos.length * 100)

  container.innerHTML = `
    <style>
      @keyframes pipelineSpin { 0% { opacity: 0.3 } 50% { opacity: 1 } 100% { opacity: 0.3 } }
      .pipeline-spin { animation: pipelineSpin 1.2s ease-in-out infinite; }
      .pipeline-spin-text { animation: pipelineSpin 1.5s ease-in-out infinite; }
    </style>
    <div style="max-width:1200px;margin:0 auto;padding:32px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Pipeline Dashboard</h2>
          <p style="color:var(--text-muted);font-size:12px">${photos.length} photos · ${completePct}% fully processed</p>
        </div>
        <button class="btn-ghost" onclick="loadPipelineStatus()">↻ Refresh</button>
      </div>

      <div style="display:flex;align-items:stretch;gap:0;margin-bottom:8px">${stageCards}</div>
      ${triggerBar}
      <div id="test-panel"></div>
      ${buildPipelineDetailPanel()}

      <div style="margin-top:28px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span style="font-size:11px;color:var(--text-dim);margin-right:4px">Filter:</span>
          ${filterPills}
        </div>
        <button onclick="deleteAllEmbeddings()"
          style="padding:4px 10px;font-size:11px;cursor:pointer;background:none;border:1px solid var(--error-border,#7f2d2d);color:var(--error,#f87171);border-radius:var(--radius-sm);white-space:nowrap"
          onmouseover="this.style.background='rgba(248,113,113,0.1)'" onmouseout="this.style.background='none'">
          Clear All Embeddings
        </button>
      </div>

      ${bulkBar}

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="padding:10px 8px 10px 12px;width:28px">
                <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="togglePipelineSelectAll()" style="cursor:pointer;accent-color:var(--primary)" />
              </th>
              <th style="text-align:left;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;padding:10px 8px">Photo</th>
              ${stepHeaders}
              <th style="text-align:right;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;padding:8px 8px">Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${filtered.length === 0 ? `<div style="text-align:center;padding:32px;color:var(--text-dim);font-size:12px">No photos match this filter</div>` : ''}
      </div>
    </div>`
}

function togglePhotoDropdown(bname) {
  const el = document.getElementById(`photo-dd-${bname}`)
  if (!el) return
  const showing = el.style.display === 'block'
  hidePhotoDropdowns()
  if (!showing) el.style.display = 'block'
}

function hidePhotoDropdowns() {
  document.querySelectorAll('[id^="photo-dd-"]').forEach(el => el.style.display = 'none')
  const runAll = document.getElementById('run-all-dropdown')
  if (runAll) runAll.style.display = 'none'
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-trigger-bname]') && !e.target.closest('[id^="photo-dd-"]') &&
      !e.target.closest('#run-all-dropdown') && !e.target.closest('[onclick*="run-all-dropdown"]')) {
    hidePhotoDropdowns()
  }
})

// ── Test Step Panel ──────────────────────────────────────────────────────────

async function runTestStep() {
  const tp = pipelineState.testPanel
  if (!tp.bname || !tp.step) { toast('Pick a photo and step'); return }
  const photo = pipelineState.photos.find(p => p.bname === tp.bname)
  tp.running = true
  tp.result = null
  renderTestPanel()

  try {
    const data = await api('/api/process/test-step', {
      method: 'POST',
      body: {
        bname: tp.bname,
        album: tp.album,
        filename: photo?.filename,
        step: tp.step,
        bucket: state.s3Config.bucket,
        prefix: state.s3Config.prefix,
        region: state.s3Config.region,
      },
    })
    tp.result = data
  } catch (e) {
    tp.result = { error: e.message }
  } finally {
    tp.running = false
    renderTestPanel()
  }
}

function openTestPanel(bname, album, step) {
  const tp = pipelineState.testPanel
  tp.open = true
  tp.bname = bname || ''
  tp.album = album || ''
  tp.step = step || 'describe'
  tp.result = null
  tp.running = false
  renderTestPanel()
}

function renderTestPanel() {
  const el = document.getElementById('test-panel')
  if (!el) return
  const tp = pipelineState.testPanel
  if (!tp.open) { el.innerHTML = ''; return }

  const stepOptions = TRIGGERABLE_STEPS.map(s =>
    `<option value="${s.key}" ${tp.step === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('')

  const photoOptions = pipelineState.photos.map(p =>
    `<option value="${esc(p.bname)}" data-album="${esc(p.album)}" ${tp.bname === p.bname ? 'selected' : ''}>${esc(p.bname)} (${esc(p.albumName)})</option>`
  ).join('')

  let resultHtml = ''
  if (tp.running) {
    resultHtml = `<div style="padding:16px;color:var(--text-muted);font-size:12px" class="pipeline-spin-text">Invoking Lambda...</div>`
  } else if (tp.result) {
    const isError = !!tp.result.error
    const json = JSON.stringify(tp.result, null, 2)
    resultHtml = `
      <div style="padding:12px">
        <div style="font-size:10px;font-weight:600;color:${isError ? 'var(--error)' : 'var(--success)'};margin-bottom:8px;text-transform:uppercase">
          ${isError ? 'Error' : 'Success'}
        </div>
        <pre style="font-size:11px;color:var(--text);background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);overflow-x:auto;max-height:400px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all">${esc(json)}</pre>
      </div>`
  }

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:700;color:var(--text)">Test Step (direct Lambda invoke)</span>
        <button onclick="pipelineState.testPanel.open=false;renderTestPanel()"
          style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px;padding:0 4px">x</button>
      </div>
      <div style="padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--text-muted)">Photo:</label>
        <select id="test-photo-select" onchange="pipelineState.testPanel.bname=this.value;pipelineState.testPanel.album=this.selectedOptions[0].dataset.album||''"
          style="flex:1;min-width:200px;padding:6px 8px;font-size:11px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm)">
          <option value="">Select a photo...</option>
          ${photoOptions}
        </select>
        <label style="font-size:11px;color:var(--text-muted)">Step:</label>
        <select onchange="pipelineState.testPanel.step=this.value"
          style="padding:6px 8px;font-size:11px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm)">
          ${stepOptions}
        </select>
        <button onclick="runTestStep()" ${tp.running ? 'disabled' : ''}
          style="padding:6px 16px;font-size:11px;font-weight:600;cursor:pointer;background:var(--warning-dim, #3d3520);border:1px solid var(--warning-border, #6b5c2e);color:var(--warning, #e8a735);border-radius:var(--radius-sm)">
          ${tp.running ? 'Running...' : 'Invoke'}
        </button>
      </div>
      ${resultHtml}
    </div>`
}

const STEP_RENDERERS = {
  1: renderStep1,
  2: renderStep2,
  3: renderStep3,
}

function render() {
  document.querySelectorAll('.mode-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.view === state.view)
  })

  const stepsNav = document.getElementById('steps-nav')
  const headerActions = document.getElementById('header-actions')
  const uploaderView = state.view === 'uploader'
  if (stepsNav) stepsNav.style.display = uploaderView ? '' : 'none'
  if (headerActions) headerActions.style.display = uploaderView ? '' : 'none'

  if (uploaderView) {
    document.querySelectorAll('.step-indicator').forEach(el => {
      const n = +el.dataset.step
      el.classList.toggle('active', n === state.step)
      el.classList.toggle('done', n < state.step)
      el.classList.toggle('locked', n > 1 && state.photos.length === 0)
    })
  }

  const main = document.getElementById('main-content')
  main.innerHTML = ''
  if (uploaderView) STEP_RENDERERS[state.step]?.(main)
  else if (state.view === 'color-lab') renderColorLab(main)
  else if (state.view === 'search-lab') renderSearchLab(main)
  else if (state.view === 'pipeline') renderPipeline(main)
  else renderEmbeddings(main)
}

async function init() {
  try {
    state.availableTags = await api('/api/tags')
  } catch {
    state.availableTags = ['landscape', 'portrait', 'architecture', 'street', 'nature', 'travel', 'event', 'other']
  }
  render()
}

init()
