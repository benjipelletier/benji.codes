import { useState, useEffect } from "react";
import ExplorerDesktop from "./components/ExplorerDesktop";
import ExplorerMobile from "./components/ExplorerMobile";
import LandingPage from "./components/LandingPage";
import useConverter from "./hooks/useConverter";

export default function App() {
  const [strictness, setStrictness] = useState("pinyin");
  const [script, setScript] = useState("simplified");
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [chains, setChains] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [chainsLoading, setChainsLoading] = useState(false);
  const convert = useConverter(script);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Load chains when current line or strictness changes
  useEffect(() => {
    if (!current) return;
    setChainsLoading(true);
    fetch(`/api/chains?line_id=${current.id}&mode=${strictness}`)
      .then(r => r.json())
      .then(data => { setChains(data.chains); setChainsLoading(false); });
  }, [current, strictness]);

  // Restore state on browser back/forward
  useEffect(() => {
    const onPopState = (e) => {
      if (e.state) {
        setCurrent(e.state.current ?? null);
        setHistory(e.state.history ?? []);
      } else {
        setCurrent(null);
        setHistory([]);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleStart = (line) => {
    setHistory([]);
    setCurrent(line);
    window.history.pushState({ current: line, history: [] }, "", `?line=${line.id}`);
  };

  const handleSelect = (chain) => {
    const nextHistory = [...history, current];
    setHistory(nextHistory);
    setCurrent(chain.to_line);
    window.history.pushState({ current: chain.to_line, history: nextHistory }, "", `?line=${chain.to_line.id}`);
  };

  const handleReset = () => {
    setCurrent(null);
    setHistory([]);
    setChains([]);
    window.history.pushState({ current: null, history: [] }, "", location.pathname);
  };

  // Landing page — no line selected yet
  if (!current) {
    return (
      <LandingPage
        onStart={handleStart}
        convert={convert}
        strictness={strictness}
        onStrictnessChange={setStrictness}
        script={script}
        onScriptChange={setScript}
      />
    );
  }

  const props = {
    current, chains, history,
    onSelect: handleSelect,
    onReset: handleReset,
    strictness, onStrictnessChange: setStrictness,
    script, onScriptChange: setScript,
    convert, chainsLoading,
  };
  return isMobile ? <ExplorerMobile {...props} /> : <ExplorerDesktop {...props} />;
}
