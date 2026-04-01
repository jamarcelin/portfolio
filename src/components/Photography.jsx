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
} from '@mui/material'
import { Close as CloseIcon, Camera, Collections } from '@mui/icons-material'
import { motion, AnimatePresence } from 'framer-motion'
import Masonry from 'react-masonry-css'
import SearchBar from './SearchBar'
import { usePhotoSearch } from '../hooks/usePhotoSearch'

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

  const visiblePhotos   = isSearching ? searchResults : filteredPhotos.slice(0, limit)
  const remaining       = isSearching ? 0 : filteredPhotos.length - limit

  const handleCollectionChange = (id) => {
    setActiveCollectionId(id)
    setLimit(PAGE_SIZE)
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
            <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 1, mb: 6 }}>
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
          <Masonry
            key={isSearching ? 'search' : activeCollectionId}
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
                    {selectedPhoto.description && (
                      <Typography sx={{ color: '#999', fontSize: '0.95rem', maxWidth: 500 }}>
                        {selectedPhoto.description}
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
