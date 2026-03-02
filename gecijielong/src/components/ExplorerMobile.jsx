import { useState } from "react";

const strictnessModes = [
  { id: "char", label: "字", desc: "Exact character" },
  { id: "pinyin", label: "拼音", desc: "With tone" },
  { id: "toneless", label: "无声调", desc: "Toneless" },
];

export default function ExplorerMobile({ current, chains, history, onSelect, strictness, onStrictnessChange }) {
  const [selected, setSelected] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

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
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
      maxWidth: "430px", margin: "0 auto",
    }}>
      {/* Ambient glow */}
      <div style={{ position: "fixed", top: "-10%", left: "20%", width: "300px", height: "300px", background: "radial-gradient(circle, rgba(180,130,60,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "10%", right: "-10%", width: "250px", height: "250px", background: "radial-gradient(circle, rgba(100,60,180,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Sticky Header */}
      <header style={{
        padding: "16px 20px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid rgba(240,230,211,0.06)",
        position: "sticky", top: 0,
        background: "rgba(10,10,15,0.95)", backdropFilter: "blur(12px)", zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: "700", letterSpacing: "0.05em", color: "#c9a96e", lineHeight: 1 }}>歌词接龙</div>
          <div style={{ fontSize: "9px", letterSpacing: "0.15em", color: "rgba(240,230,211,0.3)", textTransform: "uppercase", marginTop: "2px" }}>Lyric Chain Explorer</div>
        </div>
        <div style={{ display: "flex", gap: "2px", background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "3px", border: "1px solid rgba(255,255,255,0.06)" }}>
          {strictnessModes.map(mode => (
            <button key={mode.id} onClick={() => onStrictnessChange(mode.id)} style={{
              padding: "5px 10px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "12px", fontFamily: "inherit", transition: "all 0.2s",
              background: strictness === mode.id ? "rgba(201,169,110,0.2)" : "transparent",
              color: strictness === mode.id ? "#c9a96e" : "rgba(240,230,211,0.4)",
              fontWeight: strictness === mode.id ? "600" : "400",
            }}>
              {mode.label}
            </button>
          ))}
        </div>
      </header>

      {/* Chain history pill */}
      <div style={{ padding: "12px 20px 0" }}>
        <button onClick={() => setShowHistory(!showHistory)} style={{
          display: "flex", alignItems: "center", gap: "8px",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "20px", padding: "6px 14px", cursor: "pointer", width: "100%",
        }}>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {history.map((_, i) => (
              <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(201,169,110,0.35)" }} />
            ))}
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#c9a96e", boxShadow: "0 0 6px rgba(201,169,110,0.6)" }} />
          </div>
          <span style={{ fontSize: "11px", color: "rgba(240,230,211,0.35)", flex: 1 }}>Chain length: {history.length + 1}</span>
          <span style={{ fontSize: "11px", color: "rgba(201,169,110,0.5)", transform: showHistory ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▾</span>
        </button>
        {showHistory && (
          <div style={{ margin: "8px 0 0", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "12px 16px" }}>
            {history.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(201,169,110,0.35)", marginTop: "5px", flexShrink: 0 }} />
                  {i < history.length - 1 && <div style={{ width: "1px", flex: 1, minHeight: "24px", background: "rgba(201,169,110,0.1)" }} />}
                </div>
                <div style={{ paddingBottom: "10px" }}>
                  <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.5)" }}>{item.text}</div>
                  <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.25)", marginTop: "1px" }}>{item.song} · {item.artist}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Current lyric card */}
        <div style={{
          background: "linear-gradient(135deg, rgba(201,169,110,0.1), rgba(201,169,110,0.03))",
          border: "1px solid rgba(201,169,110,0.2)", borderRadius: "20px", padding: "28px 24px 20px",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: "10px", left: "16px", fontSize: "50px", color: "rgba(201,169,110,0.07)", lineHeight: 1, userSelect: "none" }}>「</div>
          <div style={{ fontSize: "28px", fontWeight: "700", letterSpacing: "0.12em", textAlign: "center", lineHeight: 1.4, marginBottom: "16px", position: "relative", zIndex: 1 }}>
            {current.text.split("").map((char, i) => (
              <span key={i} style={{
                color: i === current.text.length - 1 ? "#c9a96e" : "#f0e6d3",
                textShadow: i === current.text.length - 1 ? "0 0 16px rgba(201,169,110,0.5)" : "none",
              }}>{char}</span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "16px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "linear-gradient(135deg, #c9a96e, #8b6914)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>♪</div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "600" }}>{current.song}</div>
              <div style={{ fontSize: "11px", color: "rgba(240,230,211,0.4)" }}>{current.artist} · {current.year}</div>
            </div>
          </div>
          <div style={{ padding: "8px 14px", background: "rgba(201,169,110,0.08)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "12px", color: "rgba(240,230,211,0.45)" }}>
            <span>Chains from</span>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "#c9a96e", letterSpacing: "0.1em" }}>{current.end_char}</span>
            <span style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(201,169,110,0.55)" }}>({current.end_pinyin})</span>
          </div>
        </div>

        <div style={{ textAlign: "center", fontSize: "16px", color: "rgba(201,169,110,0.25)", letterSpacing: "6px" }}>↓</div>

        {/* Chain options */}
        <div>
          <div style={{ fontSize: "9px", letterSpacing: "0.2em", color: "rgba(240,230,211,0.2)", textTransform: "uppercase", marginBottom: "10px" }}>Continue the chain</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {chains.map(chain => (
              <button key={chain.id} onClick={() => handleSelect(chain)} style={{
                background: selected === chain.id ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.03)",
                border: selected === chain.id ? "1px solid rgba(201,169,110,0.5)" : "1px solid rgba(255,255,255,0.07)",
                borderRadius: "14px", padding: "14px 16px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "12px",
                transition: "all 0.2s", textAlign: "left", width: "100%",
                transform: selected === chain.id ? "scale(0.98)" : "scale(1)",
              }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: "700", color: "#c9a96e", flexShrink: 0 }}>
                  {chain.start_char}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", color: "#f0e6d3", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "#c9a96e" }}>{chain.line[0]}</span>{chain.line.slice(1)}
                  </div>
                  <div style={{ fontSize: "10px", color: "rgba(240,230,211,0.35)" }}>{chain.song} · {chain.artist}</div>
                </div>
                <div style={{ fontSize: "9px", color: "rgba(240,230,211,0.2)", flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: "14px", color: "rgba(201,169,110,0.5)", fontWeight: "600" }}>{chain.connections}</div>
                  <div>chains</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom stats */}
        <div style={{ display: "flex", justifyContent: "space-around", padding: "14px 0", borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: "4px" }}>
          {[
            { label: "Chain", value: history.length + 1 },
            { label: "Songs", value: new Set(history.map(h => h.song).concat(current.song)).size },
            { label: "Artists", value: new Set(history.map(h => h.artist).concat(current.artist)).size },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#c9a96e" }}>{stat.value}</div>
              <div style={{ fontSize: "9px", color: "rgba(240,230,211,0.25)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
