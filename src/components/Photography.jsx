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
  Button,
} from '@mui/material'
import { Close as CloseIcon, Camera } from '@mui/icons-material'
import { motion, AnimatePresence } from 'framer-motion'
import Masonry from 'react-masonry-css'

const S3_MANIFEST_URL = 'https://joshs-photo-storage.s3.us-east-1.amazonaws.com/bin/manifest.json'

const PAGE_SIZE = 12

const Photography = () => {
  const [allPhotos, setAllPhotos]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [activeTag, setActiveTag]   = useState('all')
  const [limit, setLimit]           = useState(PAGE_SIZE)

  useEffect(() => {
    fetch(S3_MANIFEST_URL)
      .then(r => r.json())
      .then(data => setAllPhotos(Array.isArray(data) ? data : []))
      .catch(() => setAllPhotos([]))
      .finally(() => setLoading(false))
  }, [])

  // Derive unique tags from all photos
  const allTags = useMemo(() => {
    const set = new Set()
    allPhotos.forEach(p => (p.tags ?? []).forEach(t => set.add(t)))
    return [...set].sort()
  }, [allPhotos])

  // Shuffle once per fetch so the grid looks different each visit
  const shuffled = useMemo(() => [...allPhotos].sort(() => Math.random() - 0.5), [allPhotos])

  const filteredPhotos = activeTag === 'all'
    ? shuffled
    : shuffled.filter(p =>
        Array.isArray(p.tags) ? p.tags.includes(activeTag) : p.category === activeTag
      )

  const visiblePhotos = filteredPhotos.slice(0, limit)
  const remaining = filteredPhotos.length - limit

  const handleTagChange = (tag) => {
    setActiveTag(tag)
    setLimit(PAGE_SIZE)
  }

  const formatTimestamp = (ts) => {
    if (!ts) return null
    try {
      return new Date(ts).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch { return null }
  }

  return (
    <Box
      id="photography"
      sx={{
        py: { xs: 8, md: 16 },
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
          <Typography
            sx={{
              textAlign: 'center',
              mb: 6,
              color: '#b3b3b3',
              fontSize: '1.2rem',
              maxWidth: 600,
              mx: 'auto',
            }}
          >
            Capturing life's fleeting moments and transforming them into timeless stories
          </Typography>
        </motion.div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 1, mb: 6 }}>
              {['all', ...allTags].map((tag) => {
                const active = activeTag === tag
                return (
                  <Chip
                    key={tag}
                    icon={tag === 'all' ? <Camera sx={{ fontSize: '0.9rem !important' }} /> : undefined}
                    label={tag === 'all' ? 'All' : tag}
                    onClick={() => handleTagChange(tag)}
                    sx={{
                      height: 32,
                      fontSize: '0.8rem',
                      fontWeight: active ? 700 : 500,
                      textTransform: 'capitalize',
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
            </Box>
          </motion.div>
        )}

        {/* Loading / empty state */}
        {(loading || allPhotos.length === 0) && (
          <Box sx={{ textAlign: 'center', py: 10 }}>
            <Camera sx={{ fontSize: '4rem', color: 'rgba(255,255,255,0.1)', mb: 2 }} />
            <Typography sx={{ color: '#555', fontSize: '1.1rem' }}>
              {loading ? 'Loading photos…' : 'No photos yet — upload some via the admin tool'}
            </Typography>
          </Box>
        )}

        {/* Masonry grid */}
        <GlobalStyles styles={{
          '.masonry-grid': {
            display: 'flex',
            marginLeft: '-16px',
            width: 'auto',
          },
          '.masonry-grid-col': {
            paddingLeft: '16px',
            backgroundClip: 'padding-box',
          },
          '.masonry-grid-col > div': {
            marginBottom: '16px',
          },
        }} />

        <Masonry
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
                  sx={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    transition: 'transform 0.4s ease',
                  }}
                />

                {/* Hover overlay */}
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
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {(photo.tags ?? [photo.category]).filter(Boolean).slice(0, 3).map(tag => (
                      <Chip
                        key={tag}
                        label={tag}
                        size="small"
                        sx={{
                          fontSize: '0.68rem',
                          height: 18,
                          background: 'rgba(255, 107, 53, 0.25)',
                          color: '#ff8a65',
                          border: '1px solid rgba(255, 107, 53, 0.3)',
                          textTransform: 'capitalize',
                          '& .MuiChip-label': { px: 0.75 },
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            </motion.div>
          ))}
        </Masonry>

        {/* Load more */}
        {remaining > 0 && (
          <Box sx={{ textAlign: 'center', mt: 6 }}>
            <Button
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              variant="outlined"
              size="large"
              sx={{
                borderRadius: '30px',
                px: 5,
                py: 1.5,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                fontWeight: 500,
                textTransform: 'none',
                fontSize: '1rem',
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(10px)',
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                },
                transition: 'all 0.3s ease',
              }}
            >
              Load more ({remaining} remaining)
            </Button>
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
                {/* Large image */}
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

                {/* Metadata row */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    {selectedPhoto.title && (
                      <Typography variant="h5" sx={{ color: '#fff', fontWeight: 700, mb: 1 }}>
                        {selectedPhoto.title}
                      </Typography>
                    )}

                    {/* Tags */}
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: selectedPhoto.camera || selectedPhoto.timestamp ? 1.5 : 0 }}>
                      {(selectedPhoto.tags ?? [selectedPhoto.category]).filter(Boolean).map(tag => (
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          sx={{
                            background: 'rgba(255, 107, 53, 0.15)',
                            color: '#ff6b35',
                            border: '1px solid rgba(255, 107, 53, 0.3)',
                            textTransform: 'capitalize',
                            fontSize: '0.8rem',
                          }}
                        />
                      ))}
                    </Box>

                    {selectedPhoto.description && (
                      <Typography sx={{ color: '#999', fontSize: '0.95rem', mt: 1, maxWidth: 500 }}>
                        {selectedPhoto.description}
                      </Typography>
                    )}
                  </Box>

                  {/* Camera + date */}
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
