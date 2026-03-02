import { useState, useEffect } from "react";
import ExplorerDesktop from "../components/ExplorerDesktop";
import ExplorerMobile from "../components/ExplorerMobile";

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
    fetch("/api/featured")
      .then(r => r.json())
      .then(data => {
        setCurrent(data.line);
        setLoading(false);
      });
  }, []);

  // Load chains when current line or strictness changes
  useEffect(() => {
    if (!current) return;
    fetch(`/api/chains?line_id=${current.id}&mode=${strictness}`)
      .then(r => r.json())
      .then(data => setChains(data.chains));
  }, [current, strictness]);

  const handleSelect = (chain) => {
    setHistory(prev => [...prev, current]);
    setCurrent(chain.to_line);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", color: "#c9a96e", fontFamily: "Georgia, serif", fontSize: "24px", letterSpacing: "0.2em" }}>
      歌词接龙
    </div>
  );

  const props = { current, chains, history, onSelect: handleSelect, strictness, onStrictnessChange: setStrictness };
  return isMobile ? <ExplorerMobile {...props} /> : <ExplorerDesktop {...props} />;
}
