import React from 'react'
import { Box, Container, Typography, IconButton, Divider } from '@mui/material'
import { GitHub, LinkedIn, Email, Favorite } from '@mui/icons-material'
import { motion } from 'framer-motion'

const Footer = () => {
  const socialLinks = [
    { icon: GitHub, href: 'https://github.com', label: 'GitHub' },
    { icon: LinkedIn, href: 'https://linkedin.com', label: 'LinkedIn' },
    { icon: Email, href: 'mailto:contact@joshmarcelin.com', label: 'Email' },
  ]

  return (
    <Box
      sx={{
        background: 'linear-gradient(180deg, #000000 0%, #0a0a0a 100%)',
        color: '#ffffff',
        py: 6,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, #00d4ff 50%, transparent 100%)',
        },
      }}
    >
      <Container maxWidth="lg">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          {/* Main Footer Content */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography
              variant="h4"
              sx={{
                mb: 2,
                background: 'linear-gradient(135deg, #ffffff 0%, #00d4ff 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontWeight: 800,
                fontSize: { xs: '1.8rem', md: '2.2rem' },
              }}
            >
              Let's Build Something Amazing
            </Typography>
            
            <Typography
              variant="body1"
              sx={{
                color: '#b3b3b3',
                fontSize: '1.1rem',
                maxWidth: 500,
                mx: 'auto',
                mb: 4,
              }}
            >
              Ready to bring your ideas to life? Let's connect and create something extraordinary together.
            </Typography>

            {/* Social Links */}
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mb: 4 }}>
              {socialLinks.map((social, index) => (
                <motion.div
                  key={social.label}
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  viewport={{ once: true }}
                  whileHover={{ scale: 1.1, y: -2 }}
                >
                  <IconButton
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      width: 50,
                      height: 50,
                      '&:hover': {
                        background: 'rgba(0, 212, 255, 0.1)',
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                        color: '#00d4ff',
                      },
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <social.icon />
                  </IconButton>
                </motion.div>
              ))}
            </Box>
          </Box>

          <Divider sx={{ 
            borderColor: 'rgba(255, 255, 255, 0.1)', 
            mb: 3,
            '&::before, &::after': {
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }
          }} />

          {/* Bottom Section */}
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 2,
          }}>
            <Typography 
              variant="body2" 
              sx={{ 
                color: '#666',
                fontSize: '0.9rem',
              }}
            >
              &copy; 2024 Josh Marcelin. All rights reserved.
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography 
                variant="body2" 
                sx={{ 
                  color: '#666',
                  fontSize: '0.9rem',
                }}
              >
                Made with
              </Typography>
              <Favorite sx={{ color: '#ff6b35', fontSize: '1rem' }} />
              <Typography 
                variant="body2" 
                sx={{ 
                  color: '#666',
                  fontSize: '0.9rem',
                }}
              >
                and lots of coffee
              </Typography>
            </Box>
          </Box>
        </motion.div>
      </Container>
    </Box>
  )
}

export default Footer
