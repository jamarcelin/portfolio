import React from 'react'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { Box } from '@mui/material'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import About from './components/About'
import PhotoPreview from './components/PhotoPreview'
import Footer from './components/Footer'
import PhotographyPage from './pages/PhotographyPage'

const Layout = () => (
  <Box sx={{ minHeight: '100vh' }}>
    <Navbar />
    <Outlet />
    <Footer />
  </Box>
)

const HomePage = () => (
  <>
    <Hero />
    <About />
    <PhotoPreview />
  </>
)

function App() {
  return (
    <BrowserRouter basename="/portfolio">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/photography" element={<PhotographyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
