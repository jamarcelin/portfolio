import { useState, useRef } from 'react'

const SEARCH_URL = 'https://xjtqlwnby3taezhwkwjjz36hbq0lhgzd.lambda-url.us-east-1.on.aws/'

export function usePhotoSearch() {
  const [results, setResults]   = useState(null)   // null = not in search mode
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const abortRef = useRef(null)

  async function search(prompt, { limit = 12, collectionId = null } = {}) {
    if (!prompt.trim()) return

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const body = { prompt: prompt.trim(), limit }
      if (collectionId) body.collectionId = collectionId

      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Search failed (${res.status})`)
      }

      const data = await res.json()
      setResults(data.results)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    if (abortRef.current) abortRef.current.abort()
    setResults(null)
    setError(null)
    setLoading(false)
  }

  return { results, loading, error, search, clear }
}
