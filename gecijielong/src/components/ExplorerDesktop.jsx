import { useState } from "react";

const strictnessModes = [
  { id: "char", label: "字", desc: "Exact character" },
  { id: "pinyin", label: "拼音", desc: "With tone" },
  { id: "toneless", label: "无声调", desc: "Toneless" },
];

export default function ExplorerDesktop({ current, chains, history, onSelect, strictness, onStrictnessChange }) {
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
      overflow: "hidden",
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
      <header style={{
        padding: "24px 40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid rgba(240,230,211,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
          <span style={{ fontSize: "22px", fontWeight: "700", letterSpacing: "0.05em", color: "#c9a96e" }}>
            歌词接龙
          </span>
          <span style={{ fontSize: "11px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.35)", textTransform: "uppercase" }}>
            Lyric Chain Explorer
          </span>
        </div>

        {/* Strictness toggle */}
        <div style={{
          display: "flex", gap: "4px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "10px", padding: "4px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          {strictnessModes.map(mode => (
            <button key={mode.id} onClick={() => onStrictnessChange(mode.id)} title={mode.desc} style={{
              padding: "6px 16px", borderRadius: "7px", border: "none", cursor: "pointer",
              fontSize: "13px", fontFamily: "inherit", transition: "all 0.2s",
              background: strictness === mode.id ? "rgba(201,169,110,0.2)" : "transparent",
              color: strictness === mode.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
              fontWeight: strictness === mode.id ? "600" : "400",
            }}>
              {mode.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.3)", letterSpacing: "0.05em" }}>benji.codes</div>
      </header>

      <div style={{ display: "flex", flex: 1, maxWidth: "1200px", margin: "0 auto", width: "100%", padding: "40px" }}>

        {/* Left: History */}
        <div style={{ width: "220px", flexShrink: 0, paddingRight: "32px" }}>
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
                  <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.5)", lineHeight: 1.4 }}>{item.text}</div>
                  <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", marginTop: "2px" }}>{item.song} · {item.artist}</div>
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
            borderRadius: "20px", padding: "36px",
            position: "relative", marginBottom: "32px",
          }}>
            <div style={{ position: "absolute", top: "16px", left: "24px", fontSize: "60px", color: "rgba(201,169,110,0.08)", lineHeight: 1, userSelect: "none" }}>「</div>
            <div style={{ fontSize: "32px", fontWeight: "700", letterSpacing: "0.15em", textAlign: "center", lineHeight: 1.4, color: "#f0e6d3", position: "relative", zIndex: 1, marginBottom: "20px" }}>
              {current.text.split("").map((char, i) => (
                <span key={i} style={{
                  color: i === current.text.length - 1 ? "#c9a96e" : "#f0e6d3",
                  textShadow: i === current.text.length - 1 ? "0 0 20px rgba(201,169,110,0.5)" : "none",
                }}>{char}</span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #c9a96e, #8b6914)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>♪</div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#f0e6d3" }}>{current.song}</div>
                <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.45)" }}>{current.artist} · {current.year}</div>
              </div>
            </div>
            <div style={{ marginTop: "24px", padding: "10px 16px", background: "rgba(201,169,110,0.08)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "13px", color: "rgba(240,230,211,0.5)" }}>
              <span>Chains from</span>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#c9a96e", letterSpacing: "0.1em" }}>{current.end_char}</span>
              <span style={{ fontSize: "11px", color: "rgba(201,169,110,0.6)", fontFamily: "monospace" }}>({current.end_pinyin})</span>
            </div>
          </div>

          <div style={{ fontSize: "20px", color: "rgba(201,169,110,0.3)", marginBottom: "24px", letterSpacing: "4px" }}>↓ ↓ ↓</div>

          {/* Chain options */}
          <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "4px" }}>Continue the chain →</div>
            {chains.map(chain => (
              <button key={chain.id} onClick={() => handleSelect(chain)} style={{
                background: selected === chain.id ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.03)",
                border: selected === chain.id ? "1px solid rgba(201,169,110,0.5)" : "1px solid rgba(255,255,255,0.07)",
                borderRadius: "14px", padding: "16px 20px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "16px",
                transition: "all 0.2s", textAlign: "left", width: "100%",
                transform: selected === chain.id ? "scale(0.99)" : "scale(1)",
              }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: "700", color: "#c9a96e", flexShrink: 0 }}>
                  {chain.start_char}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", color: "#f0e6d3", marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "#c9a96e" }}>{chain.line[0]}</span>{chain.line.slice(1)}
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.35)" }}>{chain.song} · {chain.artist}</div>
                </div>
                <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: "14px", color: "rgba(201,169,110,0.5)", fontWeight: "600" }}>{chain.connections}</div>
                  <div>chains</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Info panel */}
        <div style={{ width: "200px", flexShrink: 0, paddingLeft: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "12px" }}>Strictness Mode</div>
            <div style={{ fontSize: "13px", color: "rgba(240,230,211,0.5)", lineHeight: 1.6 }}>
              {strictness === "char" && "Exact character match only"}
              {strictness === "pinyin" && "Same pronunciation with tone (e.g. qū → 曲)"}
              {strictness === "toneless" && "Any matching syllable regardless of tone (e.g. qu → 曲去缺...)"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.25)", textTransform: "uppercase", marginBottom: "12px" }}>Current Song</div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "14px" }}>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#f0e6d3", marginBottom: "4px" }}>{current.song}</div>
              <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.45)", marginBottom: "2px" }}>{current.artist}</div>
              <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.25)" }}>{current.album}</div>
              <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.2)", marginTop: "2px" }}>{current.year}</div>
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
