import React from 'react'
import { Box, Container, Typography } from '@mui/material'
import { CloudUpload, Psychology, ImageSearch } from '@mui/icons-material'
import { motion } from 'framer-motion'

const steps = [
  {
    icon: CloudUpload,
    color: '#00d4ff',
    title: 'Ingest',
    tags: ['S3', 'SQS', 'Lambda', 'Node.js'],
    description:
      'A custom admin tool uploads originals to S3, triggering an SQS event that fans out to a Lambda processor. The Lambda generates three derivative sizes via sharp and writes structured metadata to a manifest — all without blocking the upload flow.',
  },
  {
    icon: Psychology,
    color: '#ff6b35',
    title: 'Embed',
    tags: ['Bedrock', 'Titan Embed v1', 'Vector DB'],
    description:
      'The processor calls Amazon Titan Embed Image v1 on each photo alongside its collection description, producing a 1024-dim multimodal vector. Embeddings are upserted into a private JSON store on S3, designed for warm-cache reads on repeat searches.',
  },
  {
    icon: ImageSearch,
    color: '#00ff88',
    title: 'Search',
    tags: ['API Gateway', 'Cosine Similarity', 'IaC'],
    description:
      'A query Lambda embeds the prompt text with the same model, then ranks all photos by cosine similarity in-memory. The full stack — API Gateway, IAM roles, Lambda, and S3 policies — is provisioned via Terraform for reproducible infrastructure.',
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

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {step.tags.map(tag => (
                  <Typography
                    key={tag}
                    sx={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: step.color,
                      background: `${step.color}12`,
                      border: `1px solid ${step.color}30`,
                      borderRadius: '6px',
                      px: 1,
                      py: 0.25,
                      fontFamily: 'monospace',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {tag}
                  </Typography>
                ))}
              </Box>

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
