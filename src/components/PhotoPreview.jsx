import React, { useState, useEffect, useMemo } from 'react'
import { Box, Container, Typography, Button } from '@mui/material'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowForward } from '@mui/icons-material'

const S3_MANIFEST_URL = 'https://joshs-photo-storage.s3.us-east-1.amazonaws.com/bin/manifest.json'
const PREVIEW_COUNT = 6

const PhotoPreview = () => {
  const [photos, setPhotos] = useState([])

  useEffect(() => {
    fetch(S3_MANIFEST_URL)
      .then(r => r.json())
      .then(data => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const preview = useMemo(
    () => [...photos].sort(() => Math.random() - 0.5).slice(0, PREVIEW_COUNT),
    [photos]
  )

  if (photos.length === 0) return null

  return (
    <Box
      sx={{
        py: { xs: 10, md: 14 },
        background: 'linear-gradient(180deg, #050505 0%, #0a0a0a 100%)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 0%, rgba(255, 107, 53, 0.06) 0%, transparent 60%)',
          zIndex: 1,
        },
      }}
    >
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 2 }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true }}
        >
          <Box sx={{ textAlign: 'center', mb: 6 }}>
            <Typography
              variant="h2"
              sx={{
                mb: 1.5,
                background: 'linear-gradient(135deg, #ffffff 0%, #ff6b35 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontSize: { xs: '2.2rem', md: '3rem' },
                fontWeight: 800,
                letterSpacing: '-0.02em',
              }}
            >
              Photography
            </Typography>
            <Typography sx={{ color: '#666', fontSize: '1rem', maxWidth: 480, mx: 'auto' }}>
              Moments captured around the world
            </Typography>
          </Box>
        </motion.div>

        {/* Grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            gap: 1.5,
            mb: 6,
          }}
        >
          {preview.map((photo, i) => (
            <motion.div
              key={photo.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.07 }}
              viewport={{ once: true }}
            >
              <Box
                component={Link}
                to="/photography"
                sx={{
                  display: 'block',
                  position: 'relative',
                  aspectRatio: '4 / 3',
                  overflow: 'hidden',
                  borderRadius: '12px',
                  background: '#111',
                  textDecoration: 'none',
                  '&:hover .preview-overlay': { opacity: 1 },
                  '&:hover img': { transform: 'scale(1.06)' },
                }}
              >
                <Box
                  component="img"
                  src={photo.medium || photo.src}
                  alt={photo.title || ''}
                  loading="lazy"
                  sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    transition: 'transform 0.5s ease',
                  }}
                />
                <Box
                  className="preview-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.75) 100%)',
                    opacity: 0,
                    transition: 'opacity 0.3s ease',
                    display: 'flex',
                    alignItems: 'flex-end',
                    p: 2,
                  }}
                >
                  {photo.title && (
                    <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.3 }}>
                      {photo.title}
                    </Typography>
                  )}
                </Box>
              </Box>
            </motion.div>
          ))}
        </Box>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center' }}
        >
          <Button
            component={Link}
            to="/photography"
            variant="outlined"
            endIcon={<ArrowForward />}
            sx={{
              borderRadius: '30px',
              px: 5,
              py: 1.4,
              border: '1px solid rgba(255, 107, 53, 0.4)',
              color: '#ff6b35',
              fontWeight: 500,
              fontSize: '0.95rem',
              textTransform: 'none',
              background: 'rgba(255, 107, 53, 0.05)',
              backdropFilter: 'blur(10px)',
              '&:hover': {
                background: 'rgba(255, 107, 53, 0.12)',
                borderColor: '#ff6b35',
                transform: 'translateY(-2px)',
              },
              transition: 'all 0.3s ease',
            }}
          >
            View all photography
          </Button>
        </motion.div>

      </Container>
    </Box>
  )
}

export default PhotoPreview
