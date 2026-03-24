import React from 'react'
import {
  Box,
  Container,
  Typography,
  Grid,
  Chip,
  Paper,
} from '@mui/material'
import { motion } from 'framer-motion'
import { Code, Camera, Palette, Rocket, Psychology, Speed } from '@mui/icons-material'

const About = () => {
  const skills = [
    { name: 'JavaScript', icon: Code, color: '#f7df1e' },
    { name: 'React', icon: Rocket, color: '#61dafb' },
    { name: 'Node.js', icon: Speed, color: '#339933' },
    { name: 'Python', icon: Psychology, color: '#3776ab' },
    { name: 'Photography', icon: Camera, color: '#ff6b35' },
    { name: 'UI/UX Design', icon: Palette, color: '#8b5cf6' },
  ]

  const stats = [
    { number: '3+', label: 'Years Experience' },
    { number: '50+', label: 'Projects Completed' },
    { number: '1000+', label: 'Photos Taken' },
  ]

  return (
    <Box
      id="about"
      sx={{
        py: { xs: 8, md: 16 },
        background: 'linear-gradient(180deg, #000000 0%, #0a0a0a 100%)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `
            radial-gradient(circle at 20% 80%, rgba(0, 212, 255, 0.05) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(139, 92, 246, 0.05) 0%, transparent 50%)
          `,
          zIndex: 1,
        },
      }}
    >
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 2 }}>
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
              background: 'linear-gradient(135deg, #ffffff 0%, #00d4ff 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '2.5rem', md: '3.5rem' },
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            About Me
          </Typography>
          <Typography
            variant="body1"
            sx={{
              textAlign: 'center',
              mb: 8,
              color: '#b3b3b3',
              fontSize: '1.2rem',
              maxWidth: 600,
              mx: 'auto',
            }}
          >
            Crafting digital experiences with precision and capturing life's moments with passion
          </Typography>
        </motion.div>

        {/* Stats Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          viewport={{ once: true }}
        >
          <Grid container spacing={4} sx={{ mb: 8 }}>
            {stats.map((stat, index) => (
              <Grid item xs={12} md={4} key={stat.label}>
                <Box
                  sx={{
                    textAlign: 'center',
                    p: 3,
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px',
                    backdropFilter: 'blur(10px)',
                    '&:hover': {
                      background: 'rgba(0, 212, 255, 0.05)',
                      borderColor: 'rgba(0, 212, 255, 0.2)',
                      transform: 'translateY(-5px)',
                    },
                    transition: 'all 0.3s ease',
                  }}
                >
                  <Typography
                    variant="h3"
                    sx={{
                      color: '#00d4ff',
                      fontWeight: 800,
                      fontSize: '2.5rem',
                      mb: 1,
                    }}
                  >
                    {stat.number}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: '#ffffff',
                      fontWeight: 500,
                    }}
                  >
                    {stat.label}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </motion.div>

        <Grid container spacing={8} alignItems="center">
          <Grid item xs={12} md={6}>
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              viewport={{ once: true }}
            >
              <Typography
                variant="h3"
                sx={{
                  mb: 3,
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: { xs: '1.8rem', md: '2.2rem' },
                }}
              >
                Building Tomorrow's Digital Experiences
              </Typography>
              
              <Typography
                variant="body1"
                sx={{
                  mb: 3,
                  color: '#b3b3b3',
                  fontSize: '1.1rem',
                  lineHeight: 1.7,
                }}
              >
                I'm a passionate full-stack developer and photographer who thrives at the intersection of 
                technology and creativity. With a keen eye for design and a love for clean, efficient code, 
                I create digital experiences that not only function flawlessly but also inspire and delight users.
              </Typography>
              
              <Typography
                variant="body1"
                sx={{
                  mb: 4,
                  color: '#b3b3b3',
                  fontSize: '1.1rem',
                  lineHeight: 1.7,
                }}
              >
                When I'm not crafting code, you'll find me behind the lens capturing the world's beauty, 
                or exploring new culinary adventures that fuel my creativity and passion for life.
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Chip
                  label="Available for Projects"
                  sx={{
                    background: 'rgba(0, 255, 136, 0.1)',
                    border: '1px solid rgba(0, 255, 136, 0.3)',
                    color: '#00ff88',
                    fontWeight: 600,
                    px: 2,
                    py: 1,
                  }}
                />
                <Chip
                  label="Remote Friendly"
                  sx={{
                    background: 'rgba(0, 212, 255, 0.1)',
                    border: '1px solid rgba(0, 212, 255, 0.3)',
                    color: '#00d4ff',
                    fontWeight: 600,
                    px: 2,
                    py: 1,
                  }}
                />
              </Box>
            </motion.div>
          </Grid>

          <Grid item xs={12} md={6}>
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              viewport={{ once: true }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: 4,
                  borderRadius: '24px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
                }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    mb: 3,
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '1.5rem',
                  }}
                >
                  Core Technologies
                </Typography>
                
                <Grid container spacing={2}>
                  {skills.map((skill, index) => (
                    <Grid item xs={6} key={skill.name}>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5, delay: index * 0.1 }}
                        viewport={{ once: true }}
                        whileHover={{ scale: 1.05, y: -2 }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            p: 2,
                            borderRadius: '16px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            '&:hover': {
                              background: `rgba(${parseInt(skill.color.slice(1, 3), 16)}, ${parseInt(skill.color.slice(3, 5), 16)}, ${parseInt(skill.color.slice(5, 7), 16)}, 0.1)`,
                              borderColor: `${skill.color}40`,
                              transform: 'translateY(-2px)',
                            },
                            transition: 'all 0.3s ease',
                            cursor: 'pointer',
                          }}
                        >
                          <skill.icon sx={{ color: skill.color, fontSize: '1.5rem' }} />
                          <Typography
                            variant="body2"
                            sx={{
                              color: '#ffffff',
                              fontWeight: 600,
                              fontSize: '0.9rem',
                            }}
                          >
                            {skill.name}
                          </Typography>
                        </Box>
                      </motion.div>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </motion.div>
          </Grid>
        </Grid>
      </Container>
    </Box>
  )
}

export default About
