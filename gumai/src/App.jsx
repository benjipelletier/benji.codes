import { useState, useEffect, useRef, useCallback } from 'react';
import Map from './components/Map';
import ChallengePanel from './components/ChallengePanel';
import Changelog from './components/Changelog';
import Onboarding from './components/Onboarding';
import { getProgress, markCompleted, isFirstVisit, recordVisit } from './lib/progress';
import { SEED_NODES, SEED_CONNECTIONS, SEED_CHANGELOG } from './seedData';

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [changelog, setChangelog] = useState([]);
  const [todayId, setTodayId] = useState(null);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [newConnectionIds, setNewConnectionIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const [activeNode, setActiveNode] = useState(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const panToRef = useRef(null); // set by Map, called to pan to a node id

  // Load data
  useEffect(() => {
    recordVisit();

    async function load() {
      try {
        const [nodesRes, changelogRes] = await Promise.all([
          fetch('/api/gumai/nodes'),
          fetch('/api/gumai/changelog'),
        ]);

        if (!nodesRes.ok) throw new Error('nodes fetch failed');

        const nodesData = await nodesRes.json();
        const changelogData = changelogRes.ok ? await changelogRes.json() : { entries: [] };

        setNodes(nodesData.nodes || []);
        setConnections(nodesData.connections || []);
        setTodayId(nodesData.today || null);
        setChangelog(changelogData.entries || []);
      } catch (err) {
        // Fall back to seed data (dev mode / no DB)
        console.warn('Using seed data (no DB):', err.message);
        setNodes(SEED_NODES);
        setConnections(SEED_CONNECTIONS);
        setTodayId(SEED_NODES[SEED_NODES.length - 1].id);
        setChangelog(SEED_CHANGELOG);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Load progress from localStorage
  useEffect(() => {
    const progress = getProgress();
    setCompletedIds(new Set(progress.completedNodes));
  }, []);

  // Show onboarding on first visit (after data loads)
  useEffect(() => {
    if (!loading && isFirstVisit()) {
      // isFirstVisit() checks before recordVisit was called
      // We check localStorage for 'gumai_seen_onboarding' separately
      const seen = localStorage.getItem('gumai_seen_onboarding');
      if (!seen) setShowOnboarding(true);
    }
  }, [loading]);

  function handleNodeTap(node) {
    setActiveNode(node);
  }

  function handleComplete(nodeId) {
    const updated = markCompleted(nodeId);
    setCompletedIds(new Set(updated.completedNodes));

    // Mark connections to this node as "new" for animation
    const newConns = connections
      .filter(c => c.source_id === nodeId || c.target_id === nodeId)
      .map(c => c.id);
    setNewConnectionIds(new Set(newConns));

    // Clear "new" after animation
    setTimeout(() => setNewConnectionIds(new Set()), 2000);
  }

  function handleClosePanel() {
    setActiveNode(null);
  }

  function handlePanTo(nodeId) {
    if (panToRef.current) panToRef.current(nodeId);
  }

  function dismissOnboarding() {
    localStorage.setItem('gumai_seen_onboarding', '1');
    setShowOnboarding(false);
  }

  // Build nodeMap for connection lookups
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  if (loading) {
    return (
      <div style={s.loading}>
        <span style={s.loadingChar}>古</span>
        <p style={s.loadingText}>Loading the map...</p>
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* Top bar */}
      <div style={s.topBar}>
        <h1 style={s.logo}>古脉</h1>
        <div style={s.topActions}>
          {todayId && !completedIds.has(todayId) && (
            <button
              onClick={() => handleNodeTap(nodeMap[todayId])}
              style={s.todayBtn}
            >
              今日
            </button>
          )}
          <button onClick={() => setShowChangelog(true)} style={s.iconBtn} title="Chronicle">
            <span style={s.iconBtnText}>年鉴</span>
          </button>
        </div>
      </div>

      {/* Map */}
      <Map
        nodes={nodes}
        connections={connections}
        completedIds={completedIds}
        todayId={todayId}
        newConnectionIds={newConnectionIds}
        onNodeTap={handleNodeTap}
        onPanToReady={(fn) => { panToRef.current = fn; }}
      />

      {/* Challenge / detail panel */}
      {activeNode && (
        <ChallengePanel
          node={activeNode}
          connections={connections}
          nodeMap={nodeMap}
          isCompleted={completedIds.has(activeNode.id)}
          onComplete={handleComplete}
          onClose={handleClosePanel}
          onPanTo={handlePanTo}
        />
      )}

      {/* Changelog */}
      {showChangelog && (
        <Changelog
          entries={changelog}
          onClose={() => setShowChangelog(false)}
        />
      )}

      {/* Onboarding */}
      {showOnboarding && (
        <Onboarding onDismiss={dismissOnboarding} />
      )}
    </div>
  );
}

const s = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    background: '#F5F0E8',
  },
  loading: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#F5F0E8',
    gap: 16,
  },
  loadingChar: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 72,
    color: '#1A1A1A',
    opacity: 0.15,
    animation: 'pulse 2s ease-in-out infinite',
  },
  loadingText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 14,
    color: '#8A7A6A',
    margin: 0,
  },
  topBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    zIndex: 5,
    background: 'linear-gradient(to bottom, rgba(245,240,232,0.95) 0%, rgba(245,240,232,0) 100%)',
    pointerEvents: 'none',
  },
  logo: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 24,
    color: '#1A1A1A',
    margin: 0,
    letterSpacing: '0.05em',
    pointerEvents: 'auto',
  },
  topActions: {
    display: 'flex',
    gap: 8,
    pointerEvents: 'auto',
  },
  todayBtn: {
    background: '#C23B22',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 6,
    padding: '5px 12px',
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 13,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(194,59,34,0.3)',
  },
  iconBtn: {
    background: 'rgba(245,240,232,0.85)',
    border: '1px solid #C8BFB0',
    borderRadius: 6,
    padding: '5px 10px',
    cursor: 'pointer',
  },
  iconBtnText: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 12,
    color: '#4A3A2A',
  },
};
