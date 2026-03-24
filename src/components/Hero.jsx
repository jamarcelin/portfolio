import React from 'react'
import {
  Box,
  Container,
  Typography,
  Button,
  useTheme,
  useMediaQuery,
} from '@mui/material'
import { motion } from 'framer-motion'
import { Code, Camera, Restaurant, KeyboardArrowDown } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'

const Hero = () => {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const navigate = useNavigate()

  const handleNavClick = (href) => {
    const element = document.querySelector(href)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <Box
      id="home"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'url(https://joshs-photo-storage.s3.us-east-1.amazonaws.com/bin/5T9A1411.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          zIndex: 1,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.6) 100%)',
          zIndex: 2,
        },
      }}
    >
      <Container 
        maxWidth="md" 
        sx={{ 
          position: 'relative', 
          zIndex: 3,
          textAlign: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <Box
            sx={{
              maxWidth: '700px',
              mx: 'auto',
              padding: { xs: '20px', md: '30px' },
            }}
          >
            {/* Main Title */}
            <Typography
              variant="h1"
              sx={{
                mb: 2,
                background: 'linear-gradient(135deg, #ffffff 0%, #00d4ff 50%, #ffffff 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontSize: { xs: '3rem', md: '4.5rem', lg: '5.5rem' },
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 0.9,
                fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
              }}
            >
              Josh Marcelin
            </Typography>

            {/* Subtitle with Icons */}
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Code sx={{ color: '#00d4ff', fontSize: '1.5rem' }} />
                <Typography
                  variant="h5"
                  sx={{
                    color: '#ffffff',
                    fontWeight: 400,
                    fontSize: { xs: '1.1rem', md: '1.3rem' },
                    fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
                  }}
                >
                  Developer
                </Typography>
              </Box>
              <Typography sx={{ color: '#888', fontSize: '1.5rem' }}>•</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Camera sx={{ color: '#ff6b35', fontSize: '1.5rem' }} />
                <Typography
                  variant="h5"
                  sx={{
                    color: '#ffffff',
                    fontWeight: 400,
                    fontSize: { xs: '1.1rem', md: '1.3rem' },
                    fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
                  }}
                >
                  Photographer
                </Typography>
              </Box>
              <Typography sx={{ color: '#888', fontSize: '1.5rem' }}>•</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Restaurant sx={{ color: '#00ff88', fontSize: '1.5rem' }} />
                <Typography
                  variant="h5"
                  sx={{
                    color: '#ffffff',
                    fontWeight: 400,
                    fontSize: { xs: '1.1rem', md: '1.3rem' },
                    fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
                  }}
                >
                  Food Reviewer
                </Typography>
              </Box>
            </Box>


            {/* CTA Buttons */}
            <Box sx={{ 
              display: 'flex', 
              gap: 3, 
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}>
              <Button
                variant="contained"
                size="large"
                onClick={() => handleNavClick('#about')}
                sx={{
                  borderRadius: '30px',
                  px: 4,
                  py: 1.5,
                  background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
                  color: '#000',
                  fontWeight: 600,
                  fontSize: '1rem',
                  textTransform: 'none',
                  fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
                  boxShadow: '0 8px 25px rgba(0, 212, 255, 0.3)',
                  border: 'none',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #4de6ff 0%, #00d4ff 100%)',
                    boxShadow: '0 12px 30px rgba(0, 212, 255, 0.4)',
                    transform: 'translateY(-2px)',
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                About Me
              </Button>
              
              <Button
                variant="outlined"
                size="large"
                onClick={() => navigate('/photography')}
                sx={{
                  borderRadius: '30px',
                  px: 4,
                  py: 1.5,
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  color: '#ffffff',
                  fontWeight: 500,
                  fontSize: '1rem',
                  textTransform: 'none',
                  fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(10px)',
                  '&:hover': {
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    transform: 'translateY(-2px)',
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                Photography
              </Button>
            </Box>
          </Box>
        </motion.div>
      </Container>

      
      {/* Scroll Indicator */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 4,
        }}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <KeyboardArrowDown
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '2.5rem',
              cursor: 'pointer',
              '&:hover': {
                color: '#00d4ff',
              },
              transition: 'color 0.3s ease',
            }}
            onClick={() => handleNavClick('#about')}
          />
        </motion.div>
      </Box>
    </Box>
  )
}

export default Hero

