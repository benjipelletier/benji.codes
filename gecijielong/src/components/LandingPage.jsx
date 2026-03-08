import { useState, useEffect, useRef } from "react";

function StartLineCard({ line, onSelect, convert, compact = false }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={() => onSelect(line)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(201,169,110,0.1)" : "rgba(255,255,255,0.03)",
        border: hovered ? "1px solid rgba(201,169,110,0.35)" : "1px solid rgba(255,255,255,0.07)",
        borderRadius: "14px",
        padding: compact ? "12px 14px" : "16px 20px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: compact ? "12px" : "16px",
        transition: "all 0.2s",
        textAlign: "left",
        width: "100%",
        fontFamily: "'Georgia', 'Songti SC', serif",
      }}
    >
      <div style={{ position: "relative", width: compact ? "40px" : "48px", height: compact ? "40px" : "48px", flexShrink: 0 }}>
        {line.album_art_url
          ? <img src={line.album_art_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "10px", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", borderRadius: "10px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)" }} />
        }
        <div style={{
          position: "absolute", inset: 0, borderRadius: "10px",
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: compact ? "18px" : "22px", fontWeight: "700", color: "#c9a96e",
        }}>
          {convert(line.start_char)}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: compact ? "14px" : "15px", color: "#f0e6d3",
          marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <span style={{ color: "#c9a96e" }}>{convert(line.text[0])}</span>
          {convert(line.text.slice(1))}
        </div>
        <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.35)" }}>
          {convert(line.song)} · {convert(line.artist)}
        </div>
      </div>
      {line.connections > 0 && (
        <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: compact ? "13px" : "14px", color: "rgba(201,169,110,0.5)", fontWeight: "600" }}>{line.connections}</div>
          <div>chains</div>
        </div>
      )}
    </button>
  );
}

export default function LandingPage({ onStart, convert, strictness, onStrictnessChange, script, onScriptChange }) {
  const [inputChar, setInputChar] = useState("");
  const [results, setResults] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Load suggested lines on mount
  useEffect(() => {
    fetch("/api/start-with")
      .then(r => r.json())
      .then(data => setSuggested(data.lines || []));
  }, []);

  // Debounced search as char changes
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const char = inputChar.trim();
    if (!char) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/start-with?char=${encodeURIComponent(char)}&mode=${strictness}`)
        .then(r => r.json())
        .then(data => { setResults(data.lines || []); setSearching(false); });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [inputChar, strictness]);

  const handleInput = (e) => {
    // Take only the last character typed (for IME input)
    const val = e.target.value;
    // Extract last Chinese character if present, else last char
    const chinese = val.match(/[\u4e00-\u9fff]/g);
    if (chinese) {
      setInputChar(chinese[chinese.length - 1]);
    } else if (val.length > 0) {
      setInputChar(val[val.length - 1]);
    } else {
      setInputChar("");
    }
  };

  const showResults = inputChar.trim().length > 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#f0e6d3",
      fontFamily: "'Georgia', 'Songti SC', serif",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}>
      {/* Ambient glows */}
      <div style={{
        position: "fixed", top: "-10%", left: "25%",
        width: "700px", height: "700px",
        background: "radial-gradient(circle, rgba(180,130,60,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: "-20%", right: "5%",
        width: "500px", height: "500px",
        background: "radial-gradient(circle, rgba(100,60,180,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <header style={{ borderBottom: "1px solid rgba(240,230,211,0.06)" }}>
        <div style={{
          maxWidth: "860px", margin: "0 auto", width: "100%",
          padding: "24px 40px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
            <span style={{ fontSize: "22px", fontWeight: "700", letterSpacing: "0.05em", color: "#c9a96e" }}>
              歌词接龙
            </span>
            <span style={{ fontSize: "11px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.35)", textTransform: "uppercase" }}>
              Lyric Chain Explorer
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", gap: "2px", background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "3px", border: "1px solid rgba(255,255,255,0.06)" }}>
              {[{ id: "simplified", label: "简" }, { id: "traditional", label: "繁" }].map(s => (
                <button key={s.id} onClick={() => onScriptChange(s.id)} style={{
                  padding: "5px 12px", borderRadius: "6px", border: "none", cursor: "pointer",
                  fontSize: "13px", fontFamily: "inherit", transition: "all 0.2s",
                  background: script === s.id ? "rgba(201,169,110,0.2)" : "transparent",
                  color: script === s.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
                  fontWeight: script === s.id ? "600" : "400",
                }}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.3)", letterSpacing: "0.05em" }}>
              Vibecoded with ♥ by{" "}
              <a href="https://instagram.com/benjipelletier" target="_blank" rel="noreferrer"
                style={{ color: "rgba(240,230,211,0.3)", textDecoration: "none" }}>笨鸡</a>
            </div>
          </div>
        </div>
      </header>

      <div style={{
        flex: 1,
        maxWidth: "620px", margin: "0 auto", width: "100%",
        padding: "60px 40px 80px",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ fontSize: "13px", letterSpacing: "0.25em", color: "rgba(240,230,211,0.3)", textTransform: "uppercase", marginBottom: "16px" }}>
            Start the chain
          </div>
          <div style={{ fontSize: "15px", color: "rgba(240,230,211,0.45)", lineHeight: 1.7, maxWidth: "380px" }}>
            Enter a character — find lyrics that begin with it, then follow the chain
          </div>
        </div>

        {/* Character input — main focus */}
        <div style={{ position: "relative", marginBottom: "40px", width: "100%" }}>
          <div style={{
            display: "flex", justifyContent: "center", alignItems: "center",
            gap: "24px", marginBottom: "16px",
          }}>
            <div style={{ position: "relative" }}>
              <input
                ref={inputRef}
                value={inputChar}
                onChange={handleInput}
                placeholder="字"
                maxLength={4}
                autoFocus
                style={{
                  width: "120px", height: "120px",
                  fontSize: "64px", fontWeight: "700",
                  textAlign: "center",
                  background: "rgba(201,169,110,0.06)",
                  border: inputChar ? "2px solid rgba(201,169,110,0.5)" : "2px solid rgba(240,230,211,0.1)",
                  borderRadius: "24px",
                  color: inputChar ? "#c9a96e" : "rgba(240,230,211,0.15)",
                  outline: "none",
                  fontFamily: "'Georgia', 'Songti SC', serif",
                  cursor: "text",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                  boxShadow: inputChar ? "0 0 32px rgba(201,169,110,0.15), inset 0 0 20px rgba(201,169,110,0.04)" : "none",
                  caretColor: "#c9a96e",
                }}
              />
              {inputChar && (
                <button
                  onClick={() => setInputChar("")}
                  style={{
                    position: "absolute", top: "-8px", right: "-8px",
                    width: "22px", height: "22px", borderRadius: "50%",
                    background: "rgba(240,230,211,0.1)", border: "1px solid rgba(240,230,211,0.15)",
                    color: "rgba(240,230,211,0.5)", cursor: "pointer",
                    fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "sans-serif",
                  }}
                >×</button>
              )}
            </div>
          </div>

          {/* Strictness toggle below input */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{
              display: "flex", gap: "4px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "10px", padding: "4px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              {[
                { id: "char", label: "字", desc: "Exact character" },
                { id: "pinyin", label: "拼音", desc: "With tone" },
                { id: "toneless", label: "无声调", desc: "Toneless" },
              ].map(mode => (
                <button key={mode.id} onClick={() => onStrictnessChange(mode.id)} title={mode.desc} style={{
                  padding: "6px 18px", borderRadius: "7px", border: "none", cursor: "pointer",
                  fontSize: "13px", fontFamily: "inherit", transition: "all 0.2s",
                  background: strictness === mode.id ? "rgba(201,169,110,0.2)" : "transparent",
                  color: strictness === mode.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
                  fontWeight: strictness === mode.id ? "600" : "400",
                }}>
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search results */}
        {showResults && (
          <div style={{ width: "100%", marginBottom: "48px" }}>
            <div style={{
              fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)",
              textTransform: "uppercase", marginBottom: "12px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>Lines starting with {convert(inputChar)}</span>
              {!searching && <span style={{ color: "rgba(201,169,110,0.5)" }}>{results.length} found</span>}
            </div>
            {searching ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "rgba(201,169,110,0.4)", letterSpacing: "0.3em" }}>· · ·</div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: "13px", color: "rgba(240,230,211,0.3)", marginBottom: "6px" }}>No lyrics found starting with {convert(inputChar)}</div>
                <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.2)" }}>Try a different character or chaining mode</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {results.map(line => (
                  <StartLineCard key={line.id} line={line} onSelect={onStart} convert={convert} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Suggested starts */}
        {!showResults && suggested.length > 0 && (
          <div style={{ width: "100%" }}>
            <div style={{
              fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)",
              textTransform: "uppercase", marginBottom: "12px",
            }}>
              Suggested starts
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {suggested.map(line => (
                <StartLineCard key={line.id} line={line} onSelect={onStart} convert={convert} compact />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
