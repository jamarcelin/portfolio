import React from 'react'
import { Box, Container, Typography } from '@mui/material'
import { CloudUpload, Psychology, ImageSearch } from '@mui/icons-material'
import { motion } from 'framer-motion'

const steps = [
  {
    icon: CloudUpload,
    color: '#00d4ff',
    title: 'Upload',
    description:
      'Photos are uploaded to S3 via the admin tool with a collection name and description. The description gives the embedding model semantic context about the shoot.',
  },
  {
    icon: Psychology,
    color: '#ff6b35',
    title: 'Embed',
    description:
      'A Lambda function processes each original — resizing to three sizes and calling Amazon Titan Embed Image v1 with the photo and collection description to generate a 1024-dimension vector.',
  },
  {
    icon: ImageSearch,
    color: '#00ff88',
    title: 'Search',
    description:
      'Your text prompt is embedded using the same model. A second Lambda ranks every photo by cosine similarity to the prompt and returns the closest matches in real time.',
  },
]

const HowItWorks = () => (
  <Box
    id="how-it-works"
    sx={{
      py: { xs: 10, md: 14 },
      background: 'linear-gradient(180deg, #000000 0%, #050505 100%)',
      position: 'relative',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 50% 0%, rgba(0, 212, 255, 0.04) 0%, transparent 60%)',
        pointerEvents: 'none',
      },
    }}
  >
    <Container maxWidth="lg">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        viewport={{ once: true }}
      >
        <Typography
          variant="h2"
          sx={{
            textAlign: 'center',
            mb: 2,
            background: 'linear-gradient(135deg, #ffffff 0%, #00d4ff 100%)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: { xs: '2rem', md: '2.8rem' },
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          How It Works
        </Typography>
        <Typography
          sx={{
            textAlign: 'center',
            color: '#666',
            fontSize: '1rem',
            mb: 8,
            maxWidth: 500,
            mx: 'auto',
          }}
        >
          Semantic search powered by multimodal AI embeddings
        </Typography>
      </motion.div>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 3,
          position: 'relative',
          '&::before': {
            content: '""',
            display: { xs: 'none', md: 'block' },
            position: 'absolute',
            top: 40,
            left: 'calc(16.67% + 20px)',
            right: 'calc(16.67% + 20px)',
            height: '1px',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 100%)',
          },
        }}
      >
        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: i * 0.15 }}
            viewport={{ once: true }}
          >
            <Box
              sx={{
                p: 4,
                borderRadius: '20px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                transition: 'border-color 0.3s, background 0.3s',
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderColor: `${step.color}25`,
                },
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '16px',
                  background: `${step.color}15`,
                  border: `1px solid ${step.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <step.icon sx={{ color: step.color, fontSize: '1.6rem' }} />
                <Typography
                  sx={{
                    position: 'absolute',
                    top: -8,
                    right: -8,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: step.color,
                    color: '#000',
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </Typography>
              </Box>

              <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '1.15rem' }}>
                {step.title}
              </Typography>

              <Typography sx={{ color: '#666', fontSize: '0.9rem', lineHeight: 1.7 }}>
                {step.description}
              </Typography>
            </Box>
          </motion.div>
        ))}
      </Box>
    </Container>
  </Box>
)

export default HowItWorks
