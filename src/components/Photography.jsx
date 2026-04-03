import React, { useState, useMemo, useEffect } from 'react'
import {
  Box,
  Container,
  Typography,
  GlobalStyles,
  Dialog,
  DialogContent,
  IconButton,
  Chip,
  useMediaQuery,
} from '@mui/material'
import { Close as CloseIcon, Camera, Collections, ColorLens } from '@mui/icons-material'
import { motion, AnimatePresence } from 'framer-motion'
import Masonry from 'react-masonry-css'
import SearchBar from './SearchBar'
import { usePhotoSearch } from '../hooks/usePhotoSearch'

// --- Palette color-sort helpers (ported from admin color-lab) ---

function deltaE2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1
  const { L: L2, a: a2, b: b2 } = lab2
  const avgLp = (L1 + L2) / 2
  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const avgC = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt((avgC ** 7) / ((avgC ** 7) + (25 ** 7))))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)
  const avgCp = (C1p + C2p) / 2
  const hRad = (a, b) => { const h = Math.atan2(b, a); return h >= 0 ? h : h + 2 * Math.PI }
  const h1pDeg = hRad(a1p, b1) * (180 / Math.PI)
  const h2pDeg = hRad(a2p, b2) * (180 / Math.PI)
  const dLp = L2 - L1, dCp = C2p - C1p
  let dhpDeg = 0
  if (C1p * C2p !== 0) {
    const diff = h2pDeg - h1pDeg
    dhpDeg = Math.abs(diff) <= 180 ? diff : diff > 180 ? diff - 360 : diff + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhpDeg / 2 * Math.PI / 180)
  let avgHpDeg = h1pDeg + h2pDeg
  if (C1p * C2p !== 0) {
    if (Math.abs(h1pDeg - h2pDeg) > 180) avgHpDeg += 360
    avgHpDeg /= 2
    if (avgHpDeg >= 360) avgHpDeg -= 360
  }
  const toRad = d => d * Math.PI / 180
  const T = 1 - 0.17 * Math.cos(toRad(avgHpDeg - 30)) + 0.24 * Math.cos(toRad(2 * avgHpDeg))
    + 0.32 * Math.cos(toRad(3 * avgHpDeg + 6)) - 0.20 * Math.cos(toRad(4 * avgHpDeg - 63))
  const Rc = 2 * Math.sqrt((avgCp ** 7) / ((avgCp ** 7) + (25 ** 7)))
  const Sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2)
  const Sc = 1 + 0.045 * avgCp, Sh = 1 + 0.015 * avgCp * T
  const Rt = -Math.sin(toRad(2 * 30 * Math.exp(-(((avgHpDeg - 275) / 25) ** 2)))) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

function paletteOf(photo) {
  const p = photo.colorMetadata?.palette
  if (Array.isArray(p) && p.length > 0) return p.map(e => ({ weight: e.weight ?? 0, lab: e.lab }))
  const lab = photo.colorMetadata?.average?.lab
  return [{ weight: 1, lab: lab ?? { L: 0, a: 0, b: 0 } }]
}

function colorDistancePalette(a, b) {
  const directed = (from, to) => {
    let total = 0
    for (const fa of from) {
      let best = Infinity
      for (const tb of to) best = Math.min(best, deltaE2000(fa.lab, tb.lab))
      total += best * fa.weight
    }
    return total
  }
  return (directed(a, b) + directed(b, a)) / 2
}

function twoOptImproveOrder(order, distFn, n) {
  if (order.length < 6) return order
  const windowSize = n > 350 ? 24 : 44, maxPasses = n > 350 ? 1 : 2
  const out = order.slice(), start = Date.now(), budget = n > 350 ? 200 : 260
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 1; i < out.length - 2; i++) {
      let bestK = -1, bestGain = 0
      for (let k = i + 1; k <= Math.min(out.length - 2, i + windowSize); k++) {
        const gain = (distFn(out[i - 1], out[i]) + distFn(out[k], out[k + 1]))
          - (distFn(out[i - 1], out[k]) + distFn(out[i], out[k + 1]))
        if (gain > bestGain) { bestGain = gain; bestK = k }
      }
      if (bestK !== -1) {
        let l = i, r = bestK
        while (l < r) { const t = out[l]; out[l] = out[r]; out[r] = t; l++; r-- }
        improved = true
      }
      if (i % 10 === 0 && Date.now() - start > budget) return out
    }
    if (!improved) break
  }
  return out
}

function nearestNeighborPaletteOrder(photos) {
  if (photos.length <= 2) return photos
  const palettes = photos.map(paletteOf)
  const reps = palettes.map(p => p[0]?.lab ?? { L: 0, a: 0, b: 0 })
  const remaining = new Set(photos.map((_, i) => i))
  let current = [...remaining].sort((ia, ib) => {
    const a = reps[ia], b = reps[ib]
    return a.L !== b.L ? a.L - b.L : a.a !== b.a ? a.a - b.a : a.b - b.b
  })[0]
  const orderedIdx = [current]
  remaining.delete(current)
  while (remaining.size > 0) {
    let best = -1, bestDist = Infinity
    for (const idx of remaining) {
      const d = colorDistancePalette(palettes[current], palettes[idx])
      if (d < bestDist) { bestDist = d; best = idx }
    }
    current = best; orderedIdx.push(current); remaining.delete(current)
  }
  const optimized = twoOptImproveOrder(orderedIdx, (x, y) => colorDistancePalette(palettes[x], palettes[y]), photos.length)
  return optimized.map(i => photos[i])
}

// Sort photos ROYGBIV by hue angle, normalized to 0–2π so red comes first.
function sortByHue(photos) {
  const TAU = 2 * Math.PI
  return [...photos].sort((pa, pb) => {
    const la = paletteOf(pa)[0]?.lab ?? { L: 50, a: 0, b: 0 }
    const lb = paletteOf(pb)[0]?.lab ?? { L: 50, a: 0, b: 0 }
    const ha = (Math.atan2(la.b, la.a) + TAU) % TAU
    const hb = (Math.atan2(lb.b, lb.a) + TAU) % TAU
    return ha !== hb ? ha - hb : la.L - lb.L
  })
}

// ----------------------------------------------------------------

const S3_MANIFEST_URL    = 'https://joshs-photo-storage.s3.us-east-1.amazonaws.com/bin/manifest.json'
const S3_COLLECTIONS_URL = 'https://joshs-photo-storage.s3.us-east-1.amazonaws.com/bin/collections.json'

const PAGE_SIZE = 12

const Photography = () => {
  const [allPhotos, setAllPhotos]           = useState([])
  const [collections, setCollections]       = useState([])
  const [loading, setLoading]               = useState(true)
  const [selectedPhoto, setSelectedPhoto]   = useState(null)
  const [activeCollectionId, setActiveCollectionId] = useState('all')
  const [limit, setLimit]                   = useState(PAGE_SIZE)
  const [paletteSort, setPaletteSort]       = useState(false)

  const isMobile = useMediaQuery('(max-width:500px)')
  const isTablet = useMediaQuery('(max-width:900px)')
  const masonryCols = isMobile ? 1 : isTablet ? 2 : 3
  const gridCols    = isMobile ? 3 : isTablet ? 5 : 8

  const { results: searchResults, loading: searching, error: searchError, search, clear: clearSearch } = usePhotoSearch()
  const isSearching = searchResults !== null

  useEffect(() => {
    Promise.all([
      fetch(S3_MANIFEST_URL).then(r => r.json()).catch(() => []),
      fetch(S3_COLLECTIONS_URL).then(r => r.json()).catch(() => []),
    ]).then(([photos, cols]) => {
      setAllPhotos(Array.isArray(photos) ? photos : [])
      setCollections(Array.isArray(cols) ? cols : [])
    }).finally(() => setLoading(false))
  }, [])

  const shuffled = useMemo(() => [...allPhotos].sort(() => Math.random() - 0.5), [allPhotos])

  const filteredPhotos = useMemo(() => {
    if (activeCollectionId === 'all') return shuffled
    return shuffled.filter(p => p.album === activeCollectionId)
  }, [shuffled, activeCollectionId])

  const paletteSortedPhotos = useMemo(() => {
    if (!paletteSort) return filteredPhotos
    return sortByHue(filteredPhotos)
  }, [paletteSort, filteredPhotos])

  const basePhotos      = paletteSort ? paletteSortedPhotos : filteredPhotos
  const slicedPhotos    = paletteSort ? basePhotos : basePhotos.slice(0, limit)
  const visiblePhotos   = isSearching ? searchResults : slicedPhotos
  const remaining       = isSearching || paletteSort ? 0 : basePhotos.length - limit

  const handleCollectionChange = (id) => {
    setActiveCollectionId(id)
    setLimit(PAGE_SIZE)
    setPaletteSort(false)
    clearSearch()
  }

  const handleSearch = (prompt) => {
    const colId = activeCollectionId !== 'all' ? activeCollectionId : null
    search(prompt, { limit: 20, collectionId: colId })
  }

  const formatTimestamp = (ts) => {
    if (!ts) return null
    try {
      return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch { return null }
  }

  return (
    <Box
      id="photography"
      sx={{
        py: { xs: 8, md: 12 },
        background: 'linear-gradient(180deg, #0a0a0a 0%, #000000 100%)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(circle at 80% 20%, rgba(255, 107, 53, 0.05) 0%, transparent 50%),
            radial-gradient(circle at 20% 80%, rgba(139, 92, 246, 0.05) 0%, transparent 50%)
          `,
          zIndex: 1,
        },
      }}
    >
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 2 }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <Typography
            variant="h2"
            sx={{
              textAlign: 'center',
              mb: 2,
              background: 'linear-gradient(135deg, #ffffff 0%, #ff6b35 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '2.5rem', md: '3.5rem' },
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            Photography
          </Typography>
          <Typography sx={{ textAlign: 'center', mb: 6, color: '#b3b3b3', fontSize: '1.1rem', maxWidth: 500, mx: 'auto' }}>
            Capturing life's fleeting moments and transforming them into timeless stories
          </Typography>
        </motion.div>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          viewport={{ once: true }}
        >
          <SearchBar
            onSearch={handleSearch}
            onClear={clearSearch}
            loading={searching}
            hasResults={isSearching}
          />
        </motion.div>

        {/* Collection filter */}
        {collections.length > 0 && !isSearching && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            viewport={{ once: true }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 1, mb: 6, alignItems: 'center' }}>
              {[{ s3Album: 'all', name: 'All' }, ...collections].map((col) => {
                const active = activeCollectionId === col.s3Album
                return (
                  <Chip
                    key={col.s3Album}
                    icon={col.s3Album === 'all' ? <Camera sx={{ fontSize: '0.9rem !important' }} /> : <Collections sx={{ fontSize: '0.9rem !important' }} />}
                    label={col.name}
                    onClick={() => handleCollectionChange(col.s3Album)}
                    sx={{
                      height: 32,
                      fontSize: '0.8rem',
                      fontWeight: active ? 700 : 500,
                      background: active
                        ? 'linear-gradient(135deg, #ff6b35 0%, #e64a19 100%)'
                        : 'rgba(255, 255, 255, 0.05)',
                      color: active ? '#000' : 'rgba(255,255,255,0.65)',
                      border: active ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        background: active
                          ? 'linear-gradient(135deg, #ff8a65 0%, #ff6b35 100%)'
                          : 'rgba(255, 255, 255, 0.1)',
                        color: active ? '#000' : '#fff',
                      },
                      '& .MuiChip-icon': { color: active ? '#000' : '#ff6b35' },
                    }}
                  />
                )
              })}
              <Box sx={{ width: '1px', height: 20, background: 'rgba(255,255,255,0.1)', mx: 0.5 }} />
              <Chip
                icon={<ColorLens sx={{ fontSize: '0.9rem !important' }} />}
                label="Color flow"
                onClick={() => setPaletteSort(v => !v)}
                sx={{
                  height: 32,
                  fontSize: '0.8rem',
                  fontWeight: paletteSort ? 600 : 400,
                  background: paletteSort
                    ? 'rgba(139, 92, 246, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)',
                  color: paletteSort ? 'rgba(167,139,250,1)' : 'rgba(255,255,255,0.4)',
                  border: paletteSort
                    ? '1px solid rgba(139, 92, 246, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    background: 'rgba(139, 92, 246, 0.15)',
                    color: 'rgba(167,139,250,0.9)',
                    borderColor: 'rgba(139, 92, 246, 0.3)',
                  },
                  '& .MuiChip-icon': { color: paletteSort ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.3)' },
                }}
              />
            </Box>
          </motion.div>
        )}

        {/* Search error */}
        {searchError && (
          <Typography sx={{ textAlign: 'center', color: '#ff4444', mb: 4, fontSize: '0.9rem' }}>
            {searchError}
          </Typography>
        )}

        {/* Search results label */}
        {isSearching && !searching && (
          <Typography sx={{ textAlign: 'center', color: '#666', mb: 4, fontSize: '0.85rem' }}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </Typography>
        )}

        {/* Loading / empty state */}
        {(loading || (!isSearching && allPhotos.length === 0)) && (
          <Box sx={{ textAlign: 'center', py: 10 }}>
            <Camera sx={{ fontSize: '4rem', color: 'rgba(255,255,255,0.1)', mb: 2 }} />
            <Typography sx={{ color: '#555', fontSize: '1.1rem' }}>
              {loading ? 'Loading photos…' : 'No photos yet — upload some via the admin tool'}
            </Typography>
          </Box>
        )}

        {/* Masonry grid */}
        <GlobalStyles styles={{
          '.masonry-grid': { display: 'flex', marginLeft: '-16px', width: 'auto' },
          '.masonry-grid-col': { paddingLeft: '16px', backgroundClip: 'padding-box' },
          '.masonry-grid-col > div': { marginBottom: '16px' },
        }} />

        <AnimatePresence mode="wait">
          {paletteSort && !isSearching ? (
            <Box
              key={`colorgrid-${activeCollectionId}`}
              sx={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: '3px' }}
            >
              {visiblePhotos.map((photo, index) => (
                <motion.div
                  key={photo.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: Math.min(index * 0.003, 0.4) }}
                >
                  <Box
                    onClick={() => setSelectedPhoto(photo)}
                    sx={{
                      aspectRatio: '1',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      position: 'relative',
                      '&:hover': {
                        '& .photo-overlay': { opacity: 1 },
                        '& img': { transform: 'scale(1.05)' },
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={photo.thumb || photo.medium || photo.src}
                      alt={photo.title || ''}
                      loading="lazy"
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.4s ease' }}
                    />
                    <Box
                      className="photo-overlay"
                      sx={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.8) 100%)',
                        opacity: 0, transition: 'opacity 0.3s ease',
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                        p: 1, gap: 0.5,
                      }}
                    >
                      {photo.title && (
                        <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.65rem', lineHeight: 1.2 }}>
                          {photo.title}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </motion.div>
              ))}
            </Box>
          ) : (
          <Masonry
            key={isSearching ? 'search' : `${activeCollectionId}-${masonryCols}`}
            breakpointCols={{ default: 3, 900: 2, 500: 1 }}
            className="masonry-grid"
            columnClassName="masonry-grid-col"
          >
            {visiblePhotos.map((photo, index) => (
              <motion.div
                key={photo.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
              >
                <Box
                  onClick={() => setSelectedPhoto(photo)}
                  sx={{
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: '#111',
                    display: 'block',
                    '&:hover': {
                      borderColor: 'rgba(255, 107, 53, 0.35)',
                      boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
                      '& .photo-overlay': { opacity: 1 },
                      '& img': { transform: 'scale(1.03)' },
                    },
                    transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
                  }}
                >
                  <Box
                    component="img"
                    src={photo.medium || photo.src}
                    alt={photo.title || ''}
                    loading="lazy"
                    sx={{ width: '100%', height: 'auto', display: 'block', transition: 'transform 0.4s ease' }}
                  />
                  {isSearching && (() => {
                    const score = Math.round((photo._score ?? 0) * 100)
                    const bg = score >= 70 ? 'rgba(34,197,94,0.85)'
                             : score >= 45 ? 'rgba(234,179,8,0.85)'
                             : 'rgba(239,68,68,0.85)'
                    return (
                      <Box sx={{
                        position: 'absolute', top: 8, left: 8,
                        background: bg, color: '#fff',
                        borderRadius: '6px', px: '6px', py: '2px',
                        fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.4,
                      }}>
                        {score}%
                      </Box>
                    )
                  })()}
                  <Box
                    className="photo-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.82) 100%)',
                      opacity: 0,
                      transition: 'opacity 0.3s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      p: 2,
                      gap: 0.75,
                    }}
                  >
                    {photo.title && (
                      <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3 }}>
                        {photo.title}
                      </Typography>
                    )}
                    {photo.albumName && (
                      <Typography sx={{ color: 'rgba(255,107,53,0.85)', fontSize: '0.75rem', fontWeight: 500 }}>
                        {photo.albumName}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </motion.div>
            ))}
          </Masonry>
          )}
        </AnimatePresence>

        {/* Load more */}
        {remaining > 0 && (
          <Box sx={{ textAlign: 'center', mt: 6 }}>
            <Box
              component="button"
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              sx={{
                borderRadius: '30px',
                px: 5,
                py: 1.5,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                fontWeight: 500,
                fontSize: '1rem',
                background: 'rgba(255, 255, 255, 0.05)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontFamily: 'inherit',
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                },
              }}
            >
              Load more ({remaining} remaining)
            </Box>
          </Box>
        )}

        {/* Lightbox */}
        <Dialog
          open={!!selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          maxWidth="lg"
          fullWidth
          PaperProps={{
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.96)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '20px',
            },
          }}
        >
          <DialogContent sx={{ p: { xs: 2, md: 4 }, position: 'relative' }}>
            <IconButton
              onClick={() => setSelectedPhoto(null)}
              sx={{
                position: 'absolute',
                top: 16,
                right: 16,
                color: '#fff',
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                zIndex: 1,
                '&:hover': { background: 'rgba(255, 255, 255, 0.2)' },
              }}
            >
              <CloseIcon />
            </IconButton>

            {selectedPhoto && (
              <Box>
                <Box
                  component="img"
                  src={selectedPhoto.large || selectedPhoto.src}
                  alt={selectedPhoto.title || ''}
                  sx={{
                    width: '100%',
                    maxHeight: { xs: '55vh', md: '70vh' },
                    objectFit: 'contain',
                    display: 'block',
                    borderRadius: '12px',
                    mb: 3,
                    background: '#0a0a0a',
                  }}
                />

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    {selectedPhoto.title && (
                      <Typography variant="h5" sx={{ color: '#fff', fontWeight: 700, mb: 0.5 }}>
                        {selectedPhoto.title}
                      </Typography>
                    )}
                    {selectedPhoto.albumName && (
                      <Typography sx={{ color: '#ff6b35', fontSize: '0.85rem', fontWeight: 500, mb: 1.5 }}>
                        {selectedPhoto.albumName}
                      </Typography>
                    )}
                  </Box>

                  {(selectedPhoto.camera || selectedPhoto.timestamp) && (
                    <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                      {selectedPhoto.camera && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifyContent: { xs: 'flex-start', sm: 'flex-end' }, mb: 0.5 }}>
                          <Camera sx={{ fontSize: '1rem', color: '#555' }} />
                          <Typography sx={{ color: '#888', fontSize: '0.85rem' }}>
                            {selectedPhoto.camera}
                          </Typography>
                        </Box>
                      )}
                      {selectedPhoto.timestamp && (
                        <Typography sx={{ color: '#555', fontSize: '0.8rem' }}>
                          {formatTimestamp(selectedPhoto.timestamp)}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            )}
          </DialogContent>
        </Dialog>

      </Container>
    </Box>
  )
}

export default Photography
