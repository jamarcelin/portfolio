import React, { useState } from 'react'
import { Box, InputBase, IconButton, CircularProgress, Chip } from '@mui/material'
import { Search as SearchIcon, Close as CloseIcon } from '@mui/icons-material'

const SearchBar = ({ onSearch, onClear, loading, hasResults }) => {
  const [value, setValue] = useState('')

  const submit = () => {
    if (value.trim()) onSearch(value)
  }

  const clear = () => {
    setValue('')
    onClear()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mb: 5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          maxWidth: 620,
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '50px',
          px: 2,
          py: 0.5,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          '&:focus-within': {
            borderColor: 'rgba(255, 107, 53, 0.5)',
            boxShadow: '0 0 0 3px rgba(255, 107, 53, 0.08)',
          },
        }}
      >
        <SearchIcon sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '1.2rem', mr: 1, flexShrink: 0 }} />
        <InputBase
          fullWidth
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Describe a photo to find… e.g. golden hour on the water"
          sx={{
            color: '#fff',
            fontSize: '0.95rem',
            '& input::placeholder': { color: 'rgba(255,255,255,0.3)' },
          }}
        />
        {loading ? (
          <CircularProgress size={18} sx={{ color: '#ff6b35', flexShrink: 0 }} />
        ) : value ? (
          <IconButton size="small" onClick={hasResults ? clear : submit} sx={{ color: 'rgba(255,255,255,0.4)', p: 0.5 }}>
            {hasResults ? <CloseIcon fontSize="small" /> : <SearchIcon fontSize="small" sx={{ color: '#ff6b35' }} />}
          </IconButton>
        ) : null}
      </Box>

      {hasResults && (
        <Chip
          label="Clear search"
          size="small"
          onDelete={clear}
          onClick={clear}
          sx={{
            background: 'rgba(255, 107, 53, 0.12)',
            border: '1px solid rgba(255, 107, 53, 0.3)',
            color: '#ff6b35',
            fontSize: '0.75rem',
          }}
        />
      )}
    </Box>
  )
}

export default SearchBar
