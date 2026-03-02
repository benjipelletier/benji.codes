# 歌词接龙 (Lyric Chain Explorer) — Claude Code Brief

A Chinese song lyric chaining app for **benji.codes**. Users explore chains of song lyrics where the **last character** of one lyric line connects to the **first character** of the next.

---

## Project Context

- benji.codes is Benji's Chinese learning tools site
- First tool already live: **riddlyu** — a Chengyu-based Wordle game with a clean ink-on-paper aesthetic
- 歌词接龙 should have its **own distinct identity** — do NOT match riddlyu's style
- Stack: React, Vercel, Neon (Postgres), Vercel serverless functions

---

## What It Does

Three strictness modes for chaining:
- **字 (character):** Exact character match — 最 → 最
- **拼音 (pinyin with tone):** Same sound + tone — zuì → 最/醉/罪
- **无声调 (toneless):** Any matching syllable — zui → 最/嘴/罪/追...

**Phase 1 (build this): Browse mode**
- Land on a featured song lyric
- See what songs chain from its last character
- Click a chain option to navigate forward
- History trail shows the chain so far

**Phase 2 (later): Game mode** — competitive/timed chaining

---

## Design System

### Aesthetic
Dark, moody, music-app feel. Think **Spotify meets a karaoke bar**. Stage lighting warmth. Very different from riddlyu's clean minimal look.

### Color Palette
```
Background:     #0a0a0f  (near-black, deep blue-black)
Text:           #f0e6d3  (warm off-white, like paper in dim light)
Accent/Gold:    #c9a96e  (warm amber gold — the primary accent)
Accent Dark:    #8b6914  (darker gold for gradients)
Glow Amber:     rgba(180,130,60,0.08)   (ambient light effect)
Glow Purple:    rgba(100,60,180,0.07)   (secondary ambient)
Border subtle:  rgba(240,230,211,0.06)
Border accent:  rgba(201,169,110,0.2)
Text muted:     rgba(240,230,211,0.35)
Text faint:     rgba(240,230,211,0.25)
```

### Typography
```
Font stack: 'Georgia', 'Songti SC', serif
```
Georgia gives elegant Latin text; Songti SC gives beautiful Chinese character rendering.

### Key UI Patterns
- Ambient radial gradient glows fixed in background (not interactive)
- Cards use subtle gold-tinted gradient backgrounds
- The **last character** of the current lyric is highlighted in gold (#c9a96e) with a text-shadow glow
- The **first character** of each chain option is shown in a small gold-bordered box
- Connecting character displayed prominently with its pinyin
- Buttons scale slightly on click (transform: scale(0.99))
- All transitions: 0.2s ease

---

## Desktop Layout (3-column)

```
┌─────────────────────────────────────────────────┐
│  歌词接龙   Lyric Chain Explorer  [字|拼音|无声调]  benji.codes │
├──────────┬──────────────────────────┬────────────┤
│  Chain   │                          │  Strictness│
│  History │   Current Lyric Card     │  desc      │
│          │                          │            │
│  • line  │  为你弹奏肖邦的夜[曲]      │  Current   │
│  • line  │  ♪ 夜曲 · 周杰伦 · 2005  │  Song info │
│  • line  │  Chains from [曲] (qū)   │            │
│  ● Now   │                          │  Chain     │
│          │       ↓ ↓ ↓              │  Stats     │
│          │                          │            │
│          │  Continue the chain →    │            │
│          │  [曲] 曲终人散你不在  4   │            │
│          │  [曲] 曲中人是否犹在  2   │            │
│          │  [去] 去年夏天你离开  7   │            │
│          │  [缺] 缺氧是因为你在  3   │            │
└──────────┴──────────────────────────┴────────────┘
```

**Left column (220px):** Chain history trail with dot-and-line connector, fading older entries, glowing gold "Now" dot at bottom.

**Center:** Featured lyric card (gold gradient border, last char highlighted) → arrow → chain option buttons.

**Right column (200px):** Strictness mode description, current song metadata card, chain stats.

---

## Mobile Layout

- Sticky header with title + strictness toggle
- Collapsible history pill (tap to expand chain trail)
- Single column: lyric card → arrow → chain options
- Bottom stats bar (Chain length | Songs | Artists)
- Max width 430px centered

---

## Component Files

### Desktop: `components/gecijielong/ExplorerDesktop.jsx`

```jsx
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
                  <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.5)", lineHeight: 1.4 }}>{item.line}</div>
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
              {current.line.split("").map((char, i) => (
                <span key={i} style={{
                  color: i === current.line.length - 1 ? "#c9a96e" : "#f0e6d3",
                  textShadow: i === current.line.length - 1 ? "0 0 20px rgba(201,169,110,0.5)" : "none",
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
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#c9a96e", letterSpacing: "0.1em" }}>{current.endChar}</span>
              <span style={{ fontSize: "11px", color: "rgba(201,169,110,0.6)", fontFamily: "monospace" }}>({current.endPinyin})</span>
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
                  {chain.startChar}
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
                { label: "Songs explored", value: "12" },
                { label: "Artists", value: "7" },
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
```

### Mobile: `components/gecijielong/ExplorerMobile.jsx`

```jsx
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
                  <div style={{ fontSize: "12px", color: "rgba(240,230,211,0.5)" }}>{item.line}</div>
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
            {current.line.split("").map((char, i) => (
              <span key={i} style={{
                color: i === current.line.length - 1 ? "#c9a96e" : "#f0e6d3",
                textShadow: i === current.line.length - 1 ? "0 0 16px rgba(201,169,110,0.5)" : "none",
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
            <span style={{ fontSize: "20px", fontWeight: "700", color: "#c9a96e", letterSpacing: "0.1em" }}>{current.endChar}</span>
            <span style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(201,169,110,0.55)" }}>({current.endPinyin})</span>
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
                  {chain.startChar}
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
            { label: "Songs", value: "12" },
            { label: "Artists", value: "7" },
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
```

### Main page: `pages/gecijielong/index.jsx`

```jsx
import { useState, useEffect } from "react";
import ExplorerDesktop from "../../components/gecijielong/ExplorerDesktop";
import ExplorerMobile from "../../components/gecijielong/ExplorerMobile";

export default function GeCiJieLong() {
  const [strictness, setStrictness] = useState("pinyin");
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [chains, setChains] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Load featured lyric on mount
  useEffect(() => {
    fetch("/api/gecijielong/featured")
      .then(r => r.json())
      .then(data => {
        setCurrent(data.line);
        setLoading(false);
      });
  }, []);

  // Load chains when current line or strictness changes
  useEffect(() => {
    if (!current) return;
    fetch(`/api/gecijielong/chains?line_id=${current.id}&mode=${strictness}`)
      .then(r => r.json())
      .then(data => setChains(data.chains));
  }, [current, strictness]);

  const handleSelect = (chain) => {
    setHistory(prev => [...prev, current]);
    setCurrent(chain.toLine);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a96e", fontFamily: "Georgia, serif", fontSize: "24px", letterSpacing: "0.2em" }}>
      歌词接龙
    </div>
  );

  const props = { current, chains, history, onSelect: handleSelect, strictness, onStrictnessChange: setStrictness };
  return isMobile ? <ExplorerMobile {...props} /> : <ExplorerDesktop {...props} />;
}
```

---

## Database Schema

Run this in your Neon SQL editor:

```sql
CREATE TABLE songs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  year INTEGER,
  genre TEXT,
  region TEXT,
  lrclib_id INTEGER,
  lrclib_status TEXT DEFAULT 'pending'  -- pending | found | not_found | manual
);

CREATE TABLE lyric_lines (
  id SERIAL PRIMARY KEY,
  song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_char TEXT,
  end_char TEXT,
  start_pinyin TEXT,          -- e.g. "qū"
  end_pinyin TEXT,
  start_pinyin_toneless TEXT, -- e.g. "qu"
  end_pinyin_toneless TEXT,
  timestamp_ms INTEGER        -- from LRC sync data
);

CREATE TABLE chains (
  id SERIAL PRIMARY KEY,
  from_line_id INTEGER REFERENCES lyric_lines(id) ON DELETE CASCADE,
  to_line_id INTEGER REFERENCES lyric_lines(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL,   -- 'char' | 'pinyin' | 'toneless'
  connecting_value TEXT,      -- the char/pinyin that connects them
  UNIQUE(from_line_id, to_line_id, match_type)
);

CREATE INDEX idx_lyric_lines_end_char ON lyric_lines(end_char);
CREATE INDEX idx_lyric_lines_end_pinyin ON lyric_lines(end_pinyin);
CREATE INDEX idx_lyric_lines_end_toneless ON lyric_lines(end_pinyin_toneless);
CREATE INDEX idx_chains_from_line ON chains(from_line_id, match_type);
```

---

## Neon DB Connection (`lib/db.js`)

```js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
export default sql;
```

Install: `npm install @neondatabase/serverless`

---

## API Routes

### `api/gecijielong/featured.js`
```js
import sql from "../../lib/db";

export default async function handler(req, res) {
  // Get a random lyric line from a popular song
  const [line] = await sql`
    SELECT ll.*, s.title as song, s.artist, s.album, s.year
    FROM lyric_lines ll
    JOIN songs s ON s.id = ll.song_id
    WHERE s.lrclib_status = 'found'
    ORDER BY RANDOM()
    LIMIT 1
  `;
  res.json({ line });
}
```

### `api/gecijielong/chains.js`
```js
import sql from "../../lib/db";

export default async function handler(req, res) {
  const { line_id, mode = "pinyin" } = req.query;

  const chains = await sql`
    SELECT
      c.id,
      c.connecting_value,
      ll.id as to_line_id,
      ll.text as line,
      ll.start_char,
      ll.start_pinyin,
      s.title as song,
      s.artist,
      s.year,
      -- count of onward chains from this line
      (SELECT COUNT(*) FROM chains c2 WHERE c2.from_line_id = ll.id AND c2.match_type = ${mode}) as connections
    FROM chains c
    JOIN lyric_lines ll ON ll.id = c.to_line_id
    JOIN songs s ON s.id = ll.song_id
    WHERE c.from_line_id = ${line_id}
      AND c.match_type = ${mode}
    ORDER BY connections DESC
    LIMIT 20
  `;

  res.json({ chains });
}
```

### `api/gecijielong/search.js`
```js
import sql from "../../lib/db";

export default async function handler(req, res) {
  const { q } = req.query;
  const songs = await sql`
    SELECT id, title, artist, year, genre, region
    FROM songs
    WHERE title ILIKE ${'%' + q + '%'}
       OR artist ILIKE ${'%' + q + '%'}
    LIMIT 20
  `;
  res.json({ songs });
}
```

---

## Lyrics Fetch Script (`scripts/fetch-lyrics.js`)

```js
import { neon } from "@neondatabase/serverless";
import pinyin from "pinyin";
import fs from "fs";

const sql = neon(process.env.DATABASE_URL);

// Convert char to pinyin with tone
function getPinyin(char) {
  const result = pinyin(char, { style: pinyin.STYLE_TONE2, heteronym: false });
  return result[0]?.[0] || "";
}

// Convert char to toneless pinyin
function getPinyinToneless(char) {
  const result = pinyin(char, { style: pinyin.STYLE_NORMAL, heteronym: false });
  return result[0]?.[0] || "";
}

// Parse LRC format into lines
function parseLRC(lrc) {
  const lines = [];
  for (const line of lrc.split("\n")) {
    const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
    if (match) {
      const mins = parseInt(match[1]);
      const secs = parseFloat(match[2]);
      const text = match[3].trim();
      if (text) {
        lines.push({ text, timestamp_ms: Math.round((mins * 60 + secs) * 1000) });
      }
    }
  }
  return lines;
}

async function fetchSongLyrics(song) {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(song.title)}&artist_name=${encodeURIComponent(song.artist)}`;
  const res = await fetch(url, { headers: { "User-Agent": "gecijielong/1.0 (benji.codes)" } });
  const results = await res.json();
  return results[0] || null;
}

async function processSong(song) {
  console.log(`Processing: ${song.artist} - ${song.title}`);

  const result = await fetchSongLyrics(song);
  if (!result) {
    await sql`UPDATE songs SET lrclib_status = 'not_found' WHERE id = ${song.id}`;
    console.log(`  ✗ Not found`);
    return;
  }

  const lrcText = result.syncedLyrics || result.plainLyrics;
  if (!lrcText) {
    await sql`UPDATE songs SET lrclib_status = 'not_found' WHERE id = ${song.id}`;
    return;
  }

  const rawLines = result.syncedLyrics ? parseLRC(result.syncedLyrics) : lrcText.split("\n").filter(Boolean).map(text => ({ text, timestamp_ms: null }));

  // Filter out empty/instrumental lines and lines with no Chinese chars
  const lines = rawLines.filter(l => /[\u4e00-\u9fff]/.test(l.text));

  // Insert lines
  for (let i = 0; i < lines.length; i++) {
    const { text, timestamp_ms } = lines[i];
    const chars = text.replace(/\s/g, "");
    if (!chars.length) continue;

    const startChar = chars[0];
    const endChar = chars[chars.length - 1];

    await sql`
      INSERT INTO lyric_lines (song_id, line_index, text, start_char, end_char, start_pinyin, end_pinyin, start_pinyin_toneless, end_pinyin_toneless, timestamp_ms)
      VALUES (
        ${song.id}, ${i}, ${text},
        ${startChar}, ${endChar},
        ${getPinyin(startChar)}, ${getPinyin(endChar)},
        ${getPinyinToneless(startChar)}, ${getPinyinToneless(endChar)},
        ${timestamp_ms}
      )
      ON CONFLICT DO NOTHING
    `;
  }

  await sql`UPDATE songs SET lrclib_status = 'found', lrclib_id = ${result.id} WHERE id = ${song.id}`;
  console.log(`  ✓ ${lines.length} lines`);
}

async function computeChains() {
  console.log("Computing chains...");

  // Char chains
  await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'char', a.end_char
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_char = a.end_char AND b.song_id != a.song_id
    ON CONFLICT DO NOTHING
  `;

  // Pinyin chains
  await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'pinyin', a.end_pinyin
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_pinyin = a.end_pinyin AND b.song_id != a.song_id AND a.end_pinyin != ''
    ON CONFLICT DO NOTHING
  `;

  // Toneless chains
  await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'toneless', a.end_pinyin_toneless
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_pinyin_toneless = a.end_pinyin_toneless AND b.song_id != a.song_id AND a.end_pinyin_toneless != ''
    ON CONFLICT DO NOTHING
  `;

  console.log("Chains computed!");
}

async function main() {
  const songs = await sql`SELECT * FROM songs WHERE lrclib_status = 'pending' LIMIT 50`;
  for (const song of songs) {
    await processSong(song);
    await new Promise(r => setTimeout(r, 2000)); // rate limit
  }
  await computeChains();
}

main().catch(console.error);
```

Install deps: `npm install pinyin`

Run: `node scripts/fetch-lyrics.js`

---

## Seed Songs Script (`scripts/seed-songs.js`)

Import the songs from `data/chinese_songs_final.xlsx` into the DB:

```js
import { neon } from "@neondatabase/serverless";
import XLSX from "xlsx";

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const wb = XLSX.readFile("./data/chinese_songs_final.xlsx");
  const ws = wb.Sheets["Songs"];
  const rows = XLSX.utils.sheet_to_json(ws);

  for (const row of rows) {
    await sql`
      INSERT INTO songs (title, artist, album, year, genre, region)
      VALUES (${row["Title (歌名)"]}, ${row["Artist (歌手)"]}, ${row["Album (专辑)"]}, ${row["Year (年份)"]}, ${row["Genre (类型)"]}, ${row["Region (地区)"]})
      ON CONFLICT DO NOTHING
    `;
  }
  console.log(`Seeded ${rows.length} songs`);
}

main().catch(console.error);
```

Install: `npm install xlsx`

---

## Setup Checklist

1. `vercel env add DATABASE_URL` — add Neon connection string
2. Run schema SQL in Neon console
3. `node scripts/seed-songs.js` — import 779 songs from xlsx
4. `node scripts/fetch-lyrics.js` — fetch lyrics in batches (run multiple times)
5. Build UI components from the code above
6. Deploy to Vercel

---

## File Structure

```
/
├── CLAUDE.md
├── data/
│   └── chinese_songs_final.xlsx    ← 779 curated songs
├── pages/
│   └── gecijielong/
│       └── index.jsx
├── components/
│   └── gecijielong/
│       ├── ExplorerDesktop.jsx
│       └── ExplorerMobile.jsx
├── api/
│   └── gecijielong/
│       ├── featured.js
│       ├── chains.js
│       └── search.js
├── scripts/
│   ├── seed-songs.js
│   ├── fetch-lyrics.js
│   └── compute-chains.js
└── lib/
    └── db.js
```

---

## Key Design Decisions

- **Parchment quote mark** (`「`) decorates the lyric card as a subtle watermark
- **Last character** of current lyric always highlighted gold — makes the chain mechanic visually obvious
- **First character** of each chain option shown in a stamp-like gold box
- History trail uses dot-line connectors, fading older entries, glowing "Now" dot
- Strictness toggle lives in the header, always accessible
- Chain option count ("4 chains") hints at richness of each path — encourages exploration
- Mobile collapses history to save vertical space, bottom stats bar replaces side panel
