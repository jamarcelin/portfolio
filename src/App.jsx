import React from 'react'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { Box } from '@mui/material'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Photography from './components/Photography'
import HowItWorks from './components/HowItWorks'
import Footer from './components/Footer'

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
    <Photography />
    <HowItWorks />
  </>
)

function App() {
  return (
    <BrowserRouter basename="/portfolio">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
