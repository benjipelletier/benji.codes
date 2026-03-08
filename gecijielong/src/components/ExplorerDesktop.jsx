import { useState } from "react";

const strictnessModes = [
  { id: "char", label: "字", desc: "Exact character" },
  { id: "pinyin", label: "拼音", desc: "With tone" },
  { id: "toneless", label: "无声调", desc: "Toneless" },
];

const EqLoader = () => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "5px", height: "40px", padding: "8px 0" }}>
    {[0, 0.15, 0.3, 0.45, 0.6].map((delay, i) => (
      <div key={i} style={{
        width: "4px", height: "100%", borderRadius: "2px",
        background: "rgba(201,169,110,0.5)",
        animation: `eq-bounce 0.8s ease-in-out ${delay}s infinite`,
        transformOrigin: "bottom",
      }} />
    ))}
  </div>
);

export default function ExplorerDesktop({ current, chains, history, onSelect, onReset, strictness, onStrictnessChange, script, onScriptChange, convert, chainsLoading }) {
  const [selected, setSelected] = useState(null);

  const handleSelect = (chain) => {
    setSelected(chain.id);
    setTimeout(() => setSelected(null), 600);
    onSelect(chain);
  };

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
      {/* Ambient glow effects */}
      <div style={{
        position: "fixed", top: "-20%", left: "30%",
        width: "600px", height: "600px",
        background: "radial-gradient(circle, rgba(180,130,60,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: "-10%", right: "10%",
        width: "400px", height: "400px",
        background: "radial-gradient(circle, rgba(100,60,180,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <header style={{ borderBottom: "1px solid rgba(240,230,211,0.06)" }}>
        <div style={{
          maxWidth: "1200px", margin: "0 auto", width: "100%",
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
          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <button onClick={onReset} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "rgba(240,230,211,0.3)", letterSpacing: "0.05em", fontFamily: "inherit", padding: 0, transition: "color 0.2s" }}
              onMouseEnter={e => e.target.style.color = "#c9a96e"}
              onMouseLeave={e => e.target.style.color = "rgba(240,230,211,0.3)"}
            >← New chain</button>
            <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.3)", letterSpacing: "0.05em" }}>Vibecoded with ♥ by <a href="https://instagram.com/benjipelletier" target="_blank" rel="noreferrer" style={{ color: "rgba(240,230,211,0.3)", textDecoration: "none" }}>笨鸡</a></div>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, maxWidth: "1200px", margin: "0 auto", width: "100%", padding: "40px" }}>

        {/* Left: History */}
        <div style={{ width: "220px", flexShrink: 0, paddingRight: "32px", position: "sticky", top: "40px", alignSelf: "flex-start" }}>
          <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "20px" }}>
            Chain History
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {history.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(201,169,110,0.4)", marginTop: "4px", flexShrink: 0 }} />
                  {i < history.length - 1 && (
                    <div style={{ width: "1px", flex: 1, minHeight: "32px", background: "rgba(201,169,110,0.1)" }} />
                  )}
                </div>
                <div style={{ paddingBottom: "16px" }}>
                  <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.5)", lineHeight: 1.4 }}>{convert(item.text)}</div>
                  <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", marginTop: "2px" }}>{convert(item.song)} · {convert(item.artist)}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#c9a96e", marginTop: "3px", flexShrink: 0, boxShadow: "0 0 8px rgba(201,169,110,0.6)" }} />
              <div style={{ fontSize: "11px", color: "#c9a96e" }}>Now</div>
            </div>
          </div>
        </div>

        {/* Center: Current + Chains */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Current lyric card */}
          <div style={{
            width: "100%", maxWidth: "480px",
            background: "linear-gradient(135deg, rgba(201,169,110,0.08), rgba(201,169,110,0.03))",
            border: "1px solid rgba(201,169,110,0.2)",
            borderRadius: "20px", padding: "36px 36px 24px",
            position: "relative", marginBottom: "32px",
          }}>
            <div style={{ fontSize: "32px", fontWeight: "700", letterSpacing: "0.15em", textAlign: "center", lineHeight: 1.4, color: "#f0e6d3", position: "relative", zIndex: 1, marginBottom: "20px" }}>
              {convert(current.text).split("").map((char, i, arr) => (
                <span key={i} style={{
                  color: i === arr.length - 1 ? "#c9a96e" : "#f0e6d3",
                  textShadow: i === arr.length - 1 ? "0 0 20px rgba(201,169,110,0.5)" : "none",
                }}>{char}</span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                {current.album_art_url
                  ? <img src={current.album_art_url} alt="" style={{ width: "48px", height: "48px", borderRadius: "8px", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "48px", height: "48px", borderRadius: "8px", background: "linear-gradient(135deg, #c9a96e, #8b6914)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>♪</div>
                }
                {current.spotify_url && (
                  <a href={current.spotify_url} target="_blank" rel="noreferrer" style={{ position: "absolute", bottom: "-4px", right: "-4px", width: "16px", height: "16px", borderRadius: "50%", background: "#1db954", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", boxShadow: "0 0 0 2px #0a0a0f" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                  </a>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#f0e6d3" }}>{convert(current.song)}</div>
                <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.45)" }}>{convert(current.artist)} · {current.year}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "24px", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <span style={{ fontSize: "20px", color: "rgba(201,169,110,0.3)" }}>↓</span>
              <span style={{ fontSize: "32px", fontWeight: "700", color: "#c9a96e", textShadow: "0 0 20px rgba(201,169,110,0.4)", letterSpacing: "0.1em" }}>{convert(current.end_char)}</span>
              <span style={{ fontSize: "20px", color: "rgba(201,169,110,0.3)" }}>↓</span>
            </div>
            <span style={{ fontSize: "11px", color: "rgba(201,169,110,0.5)", fontFamily: "monospace" }}>{current.end_pinyin}</span>
          </div>

          {/* Chain options */}
          <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "4px", display: "flex", justifyContent: "space-between" }}>
              <span>Continue the chain →</span>
              {!chainsLoading && <span style={{ color: "rgba(201,169,110,0.5)" }}>{chains.length} match{chains.length !== 1 ? "es" : ""}</span>}
            </div>
            {chainsLoading ? <EqLoader /> : chains.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: "28px", marginBottom: "10px", letterSpacing: "0.3em", color: "rgba(201,169,110,0.3)" }}>♪ · · ·</div>
                <div style={{ fontSize: "13px", color: "rgba(240,230,211,0.35)", letterSpacing: "0.05em" }}>The chain ends here</div>
                <div style={{ fontSize: "11px", marginTop: "6px", color: "rgba(240,230,211,0.2)" }}>Try 拼音 or 无声调 to find more connections</div>
              </div>
            ) : chains.flatMap((chain, i) => {
              const showDivider = chain.is_loop && (i === 0 || !chains[i - 1].is_loop);
              return [
                showDivider && (
                  <div key="loop-divider" style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0" }}>
                    <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
                    <span style={{ fontSize: "9px", letterSpacing: "0.15em", color: "rgba(240,230,211,0.2)", textTransform: "uppercase" }}>↩ loops back</span>
                    <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
                  </div>
                ),
                <button key={chain.id} onClick={() => handleSelect(chain)} style={{
                  background: selected === chain.id ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.03)",
                  border: selected === chain.id ? "1px solid rgba(201,169,110,0.5)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "14px", padding: "16px 20px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "16px",
                  transition: "all 0.2s", textAlign: "left", width: "100%",
                  transform: selected === chain.id ? "scale(0.99)" : "scale(1)",
                  opacity: chain.is_loop ? 0.6 : 1,
                }}>
                <div style={{ position: "relative", width: "44px", height: "44px", flexShrink: 0 }}>
                  {chain.to_line?.album_art_url
                    ? <img src={chain.to_line.album_art_url} alt="" style={{ width: "44px", height: "44px", borderRadius: "10px", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)" }} />
                  }
                  <div style={{ position: "absolute", inset: 0, borderRadius: "10px", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: "700", color: "#c9a96e" }}>
                    {convert(chain.start_char)}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", color: "#f0e6d3", marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "#c9a96e" }}>{convert(chain.line[0])}</span>{convert(chain.line.slice(1))}
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.35)" }}>{convert(chain.song)} · {convert(chain.artist)}</div>
                </div>
                <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: "14px", color: "rgba(201,169,110,0.5)", fontWeight: "600" }}>{chain.connections}</div>
                  <div>chains</div>
                </div>
              </button>,
              ].filter(Boolean);
            })}
          </div>
        </div>

        {/* Right: Info panel */}
        <div style={{ width: "200px", flexShrink: 0, paddingLeft: "32px", display: "flex", flexDirection: "column", gap: "20px", position: "sticky", top: "40px", alignSelf: "flex-start" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "12px" }}>Chaining Mode</div>
            <div style={{
              display: "flex", flexDirection: "row", gap: "4px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "10px", padding: "4px",
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: "12px",
            }}>
              {strictnessModes.map(mode => (
                <button key={mode.id} onClick={() => onStrictnessChange(mode.id)} style={{
                  flex: 1, padding: "6px 0", borderRadius: "7px", border: "none", cursor: "pointer",
                  textAlign: "center",
                  fontSize: "13px", fontFamily: "inherit", transition: "all 0.2s",
                  background: strictness === mode.id ? "rgba(201,169,110,0.2)" : "transparent",
                  color: strictness === mode.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
                  fontWeight: strictness === mode.id ? "600" : "400",
                }}>
                  {mode.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.45)", lineHeight: 1.6 }}>
              {strictness === "char" && "Exact character match only"}
              {strictness === "pinyin" && "Same pronunciation with tone (e.g. qū → 曲)"}
              {strictness === "toneless" && "Any matching syllable regardless of tone (e.g. qu → 曲去缺...)"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "12px" }}>Script</div>
            <div style={{
              display: "flex", flexDirection: "row", gap: "4px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "10px", padding: "4px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              {[{ id: "simplified", label: "简" }, { id: "traditional", label: "繁" }].map(s => (
                <button key={s.id} onClick={() => onScriptChange(s.id)} style={{
                  flex: 1, padding: "6px 0", borderRadius: "7px", border: "none", cursor: "pointer",
                  textAlign: "center", fontSize: "13px", fontFamily: "inherit", transition: "all 0.2s",
                  background: script === s.id ? "rgba(201,169,110,0.2)" : "transparent",
                  color: script === s.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
                  fontWeight: script === s.id ? "600" : "400",
                }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "12px" }}>Chain Stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "Chain length", value: history.length + 1 },
                { label: "Songs explored", value: new Set(history.map(h => h.song).concat(current.song)).size },
                { label: "Artists", value: new Set(history.map(h => h.artist).concat(current.artist)).size },
              ].map(stat => (
                <div key={stat.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span style={{ color: "rgba(240,230,211,0.35)" }}>{stat.label}</span>
                  <span style={{ color: "#c9a96e", fontWeight: "600" }}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
