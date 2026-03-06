import { useState, useEffect, useCallback } from 'react'

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSpotifyUrl(raw) {
  if (!raw) return null
  // Match open.spotify.com/track/... (with or without query params)
  const match = raw.match(/https?:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+/)
  return match ? match[0] : null
}

async function fetchTrackInfo(spotifyUrl) {
  // Spotify oEmbed — no API key needed, CORS-enabled
  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`
  )
  if (!res.ok) throw new Error('Could not fetch track info from Spotify')
  const data = await res.json()
  return {
    title: data.title,
    artist: data.author_name,
    thumbnail: data.thumbnail_url,
    // oEmbed title format is usually "Song Name" but sometimes "Song - Artist"
  }
}

async function fetchLyrics(title, artist) {
  // lrclib.net is CORS-enabled, no API key needed
  const params = new URLSearchParams({ track_name: title, artist_name: artist })
  const res = await fetch(`https://lrclib.net/api/search?${params}`)
  if (!res.ok) throw new Error('Could not reach lrclib.net')
  const results = await res.json()
  if (!results.length) return null

  // Prefer results with synced lyrics; fall back to plain
  const withSynced = results.find(r => r.syncedLyrics)
  const best = withSynced || results[0]

  if (best.syncedLyrics) {
    return parseLRC(best.syncedLyrics)
  } else if (best.plainLyrics) {
    return best.plainLyrics.split('\n').filter(l => l.trim())
  }
  return null
}

function parseLRC(lrc) {
  const lines = []
  for (const line of lrc.split('\n')) {
    // Strip [mm:ss.xx] timestamps
    const match = line.match(/^\[[\d:.]+\](.*)/)
    if (match) {
      const text = match[1].trim()
      if (text) lines.push(text)
    }
  }
  return lines
}

async function sendToPleco(lyrics) {
  const text = lyrics.join('\n')

  // 1. Copy to clipboard (guaranteed fallback)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard may be denied — not fatal
  }

  // 2. Try Pleco URL scheme (works on iOS/Android if Pleco is installed)
  // plecoapi://x-callback-url/r?s=TEXT opens the reader with text
  window.location.href = `plecoapi://x-callback-url/r?s=${encodeURIComponent(text)}`
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const S = {
  root: {
    minHeight: '100dvh',
    background: '#0a0a0f',
    color: '#f0e6d3',
    fontFamily: "'Georgia', 'Songti SC', serif",
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    maxWidth: '480px',
    margin: '0 auto',
  },
  glow1: {
    position: 'fixed', top: '-15%', left: '25%',
    width: '400px', height: '400px',
    background: 'radial-gradient(circle, rgba(180,130,60,0.09) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  glow2: {
    position: 'fixed', bottom: '5%', right: '-10%',
    width: '300px', height: '300px',
    background: 'radial-gradient(circle, rgba(100,60,180,0.07) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  header: {
    padding: '20px 24px 16px',
    borderBottom: '1px solid rgba(240,230,211,0.06)',
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
  },
  headerTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#c9a96e',
    letterSpacing: '0.05em',
  },
  headerSub: {
    fontSize: '11px',
    color: 'rgba(240,230,211,0.3)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  },
  content: {
    flex: 1,
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    paddingBottom: '100px', // room for sticky button
  },
  songCard: {
    background: 'linear-gradient(135deg, rgba(201,169,110,0.09), rgba(201,169,110,0.03))',
    border: '1px solid rgba(201,169,110,0.2)',
    borderRadius: '16px',
    padding: '16px',
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
  },
  albumArt: {
    width: '60px',
    height: '60px',
    borderRadius: '8px',
    objectFit: 'cover',
    flexShrink: 0,
    background: 'rgba(201,169,110,0.1)',
  },
  albumArtPlaceholder: {
    width: '60px',
    height: '60px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #c9a96e, #8b6914)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    flexShrink: 0,
  },
  songTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#f0e6d3',
    marginBottom: '3px',
  },
  songArtist: {
    fontSize: '13px',
    color: 'rgba(240,230,211,0.5)',
  },
  lyricsBlock: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  lyricsLabel: {
    fontSize: '10px',
    letterSpacing: '0.2em',
    color: 'rgba(240,230,211,0.25)',
    textTransform: 'uppercase',
    marginBottom: '4px',
  },
  lyricLine: {
    fontSize: '17px',
    lineHeight: '1.7',
    color: '#f0e6d3',
    letterSpacing: '0.05em',
  },
  stickyBottom: {
    position: 'fixed',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: '480px',
    padding: '16px 24px',
    background: 'linear-gradient(to top, #0a0a0f 70%, transparent)',
    zIndex: 10,
  },
  plecoBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #c9a96e, #8b6914)',
    border: 'none',
    borderRadius: '14px',
    color: '#0a0a0f',
    fontSize: '16px',
    fontWeight: '700',
    fontFamily: "'Georgia', 'Songti SC', serif",
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'transform 0.15s, opacity 0.15s',
  },
  inputArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
    padding: '40px 24px',
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: '14px',
    color: 'rgba(240,230,211,0.4)',
    lineHeight: '1.6',
  },
  inputRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  textInput: {
    width: '100%',
    padding: '14px 16px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    color: '#f0e6d3',
    fontSize: '14px',
    fontFamily: "'Georgia', 'Songti SC', serif",
    outline: 'none',
  },
  goBtn: {
    padding: '14px',
    background: 'rgba(201,169,110,0.15)',
    border: '1px solid rgba(201,169,110,0.3)',
    borderRadius: '12px',
    color: '#c9a96e',
    fontSize: '15px',
    fontWeight: '700',
    fontFamily: "'Georgia', 'Songti SC', serif",
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  instructions: {
    background: 'rgba(201,169,110,0.05)',
    border: '1px solid rgba(201,169,110,0.12)',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '13px',
    color: 'rgba(240,230,211,0.4)',
    lineHeight: '1.7',
    textAlign: 'left',
  },
  spinner: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: 'rgba(201,169,110,0.6)',
    fontSize: '28px',
    letterSpacing: '0.15em',
  },
  errorBox: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '40px 24px',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: '18px',
    color: '#f0e6d3',
    fontWeight: '700',
  },
  errorMsg: {
    fontSize: '14px',
    color: 'rgba(240,230,211,0.4)',
    lineHeight: '1.6',
  },
  retryBtn: {
    padding: '12px 24px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: 'rgba(240,230,211,0.6)',
    fontSize: '14px',
    fontFamily: "'Georgia', 'Songti SC', serif",
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(201,169,110,0.9)',
    color: '#0a0a0f',
    padding: '10px 20px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '700',
    zIndex: 100,
    whiteSpace: 'nowrap',
  },
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState('idle') // idle | loading | found | not_found | error
  const [track, setTrack] = useState(null)
  const [lyrics, setLyrics] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [toast, setToast] = useState('')
  const [btnPressed, setBtnPressed] = useState(false)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const loadFromSpotifyUrl = useCallback(async (rawUrl) => {
    const spotifyUrl = extractSpotifyUrl(rawUrl)
    if (!spotifyUrl) {
      setErrorMsg('No Spotify track link found. Make sure you share a track (not an album or playlist).')
      setState('error')
      return
    }

    setState('loading')
    try {
      const info = await fetchTrackInfo(spotifyUrl)
      setTrack(info)

      const lines = await fetchLyrics(info.title, info.artist)
      if (!lines || !lines.length) {
        setState('not_found')
        return
      }
      setLyrics(lines)
      setState('found')
    } catch (err) {
      setErrorMsg(err.message || 'Something went wrong.')
      setState('error')
    }
  }, [])

  // Check URL params on mount (from Web Share Target or manual link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlParam = params.get('url') || params.get('text')
    if (urlParam) {
      loadFromSpotifyUrl(urlParam)
    }
  }, [loadFromSpotifyUrl])

  const handleGo = () => {
    if (!inputUrl.trim()) return
    loadFromSpotifyUrl(inputUrl.trim())
  }

  const handlePleco = async () => {
    setBtnPressed(true)
    setTimeout(() => setBtnPressed(false), 150)
    await sendToPleco(lyrics)
    showToast('Lyrics copied · Opening Pleco...')
  }

  const handleReset = () => {
    setState('idle')
    setTrack(null)
    setLyrics([])
    setInputUrl('')
    setErrorMsg('')
    // Clear URL params without reload
    window.history.replaceState({}, '', '/')
  }

  return (
    <div style={S.root}>
      <div style={S.glow1} />
      <div style={S.glow2} />

      {toast && <div style={S.toast}>{toast}</div>}

      <header style={S.header}>
        <span style={S.headerTitle}>歌词桥</span>
        <span style={S.headerSub}>Lyrics Bridge</span>
      </header>

      {state === 'idle' && (
        <div style={S.inputArea}>
          <div style={{ fontSize: '40px' }}>♪</div>
          <div style={S.inputLabel}>
            Paste a Spotify track link to find the lyrics and send them to Pleco.
          </div>
          <div style={S.inputRow}>
            <input
              style={S.textInput}
              type="url"
              placeholder="https://open.spotify.com/track/..."
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGo()}
              autoFocus
            />
            <button style={S.goBtn} onClick={handleGo}>
              Find Lyrics →
            </button>
          </div>
          <div style={S.instructions}>
            <strong style={{ color: 'rgba(240,230,211,0.7)' }}>Share from Spotify:</strong>
            {' '}Install this site as an app (Add to Home Screen), then use Spotify's Share button — 歌词桥 will appear as a share target.
          </div>
        </div>
      )}

      {state === 'loading' && (
        <div style={S.spinner}>
          <div>歌词桥</div>
          <div style={{ fontSize: '13px', color: 'rgba(240,230,211,0.3)', letterSpacing: '0.2em' }}>
            FINDING LYRICS...
          </div>
        </div>
      )}

      {state === 'found' && track && (
        <>
          <div style={S.content}>
            {/* Song card */}
            <div style={S.songCard}>
              {track.thumbnail ? (
                <img src={track.thumbnail} alt="" style={S.albumArt} />
              ) : (
                <div style={S.albumArtPlaceholder}>♪</div>
              )}
              <div>
                <div style={S.songTitle}>{track.title}</div>
                <div style={S.songArtist}>{track.artist}</div>
              </div>
            </div>

            {/* Lyrics */}
            <div style={S.lyricsBlock}>
              <div style={S.lyricsLabel}>歌词 · Lyrics</div>
              {lyrics.map((line, i) => (
                <div key={i} style={S.lyricLine}>{line}</div>
              ))}
            </div>

            <button style={{ ...S.retryBtn, alignSelf: 'flex-start' }} onClick={handleReset}>
              ← New song
            </button>
          </div>

          <div style={S.stickyBottom}>
            <button
              style={{
                ...S.plecoBtn,
                transform: btnPressed ? 'scale(0.98)' : 'scale(1)',
                opacity: btnPressed ? 0.9 : 1,
              }}
              onClick={handlePleco}
            >
              Open in Pleco 📖
            </button>
          </div>
        </>
      )}

      {state === 'not_found' && (
        <div style={S.errorBox}>
          <div style={{ fontSize: '36px' }}>歌</div>
          <div style={S.errorTitle}>Lyrics not found</div>
          {track && (
            <div style={{ ...S.errorMsg, fontStyle: 'italic' }}>
              "{track.title}" by {track.artist}
            </div>
          )}
          <div style={S.errorMsg}>
            This song isn't in lrclib.net's database yet.
            Try searching for it manually on lrclib.net.
          </div>
          <button style={S.retryBtn} onClick={handleReset}>
            Try another song
          </button>
        </div>
      )}

      {state === 'error' && (
        <div style={S.errorBox}>
          <div style={{ fontSize: '36px' }}>⚠</div>
          <div style={S.errorTitle}>Something went wrong</div>
          <div style={S.errorMsg}>{errorMsg}</div>
          <button style={S.retryBtn} onClick={handleReset}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
