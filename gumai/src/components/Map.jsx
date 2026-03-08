import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { dynastyToX, getActiveDynasties } from '../lib/dynasties';
import Node from './Node';
import Connection from './Connection';
import FogOfWarDefs from './FogOfWar';

const NODE_RADIUS = 16;

export default function Map({ nodes, connections, completedIds, todayId, newConnectionIds, onNodeTap, onPanToReady }) {
  const svgRef = useRef(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [positions, setPositions] = useState({});
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const simulationRef = useRef(null);
  const zoomRef = useRef(null);
  const centeredRef = useRef(false);

  // Track window size
  useEffect(() => {
    const handler = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Run d3-force simulation
  useEffect(() => {
    if (!nodes.length) return;

    // Stop previous simulation
    if (simulationRef.current) simulationRef.current.stop();

    const simNodes = nodes.map(n => ({
      id: n.id,
      dynasty: n.dynasty,
      x: dynastyToX(n.dynasty) + (Math.random() - 0.5) * 40,
      y: dims.h / 2 + (Math.random() - 0.5) * 120,
    }));

    const simLinks = connections.map(c => ({
      source: c.source_id,
      target: c.target_id,
    }));

    const simulation = d3.forceSimulation(simNodes)
      .force('x', d3.forceX(d => dynastyToX(d.dynasty)).strength(0.8))
      .force('y', d3.forceY(dims.h / 2).strength(0.05))
      .force('collide', d3.forceCollide(NODE_RADIUS * 2.8))
      .force('link', d3.forceLink(simLinks).id(d => d.id).distance(90).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-60));

    simulation.on('tick', () => {
      const pos = {};
      simNodes.forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
      setPositions({ ...pos });
    });

    simulation.on('end', () => {
      simulation.stop();
    });

    simulationRef.current = simulation;
    return () => simulation.stop();
  }, [nodes.map(n => n.id).join(','), connections.length, dims.h]);

  // Set up d3-zoom (once on mount)
  useEffect(() => {
    if (!svgRef.current) return;

    const zoom = d3.zoom()
      .scaleExtent([0.08, 5])
      .on('zoom', (event) => {
        const t = event.transform;
        transformRef.current = { x: t.x, y: t.y, k: t.k };
        setTransform({ x: t.x, y: t.y, k: t.k });
      });

    d3.select(svgRef.current).call(zoom);
    zoomRef.current = zoom;

    return () => {
      d3.select(svgRef.current).on('.zoom', null);
    };
  }, []);

  // Expose panTo function to parent
  useEffect(() => {
    if (!onPanToReady) return;
    onPanToReady((nodeId) => {
      const pos = positions[nodeId];
      if (!pos || !svgRef.current || !zoomRef.current) return;
      const scale = 1.6;
      const tx = dims.w / 2 - pos.x * scale;
      const ty = dims.h / 2 - pos.y * scale;
      d3.select(svgRef.current)
        .transition()
        .duration(600)
        .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    });
  }, [positions, dims, onPanToReady]);

  // Auto-center on today's node once positions are ready
  useEffect(() => {
    if (centeredRef.current) return;
    if (!todayId || !positions[todayId] || !svgRef.current || !zoomRef.current) return;

    const { x, y } = positions[todayId];
    const scale = 1.4;
    const tx = dims.w / 2 - x * scale;
    const ty = dims.h / 2 - y * scale;

    d3.select(svgRef.current)
      .transition()
      .duration(800)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );

    centeredRef.current = true;
  }, [positions, todayId, dims]);

  const activeDynasties = getActiveDynasties(nodes);
  const { x: tx, y: ty, k: tk } = transform;

  return (
    <svg
      ref={svgRef}
      width={dims.w}
      height={dims.h}
      style={s.svg}
    >
      <FogOfWarDefs />

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; r: 24px; }
          50% { opacity: 0.7; r: 28px; }
        }
        @keyframes pulseRing {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.15); }
        }
      `}</style>

      <g transform={`translate(${tx},${ty}) scale(${tk})`}>
        {/* Dynasty timeline labels */}
        {tk > 0.3 && activeDynasties.map(({ dynasty, x }) => (
          <text
            key={dynasty}
            x={x}
            y={dims.h / 2 + 120}
            textAnchor="middle"
            fontFamily="'Ma Shan Zheng', serif"
            fontSize={tk < 0.6 ? 22 : 16}
            fill="#8A7A6A"
            opacity={0.4}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {dynasty}
          </text>
        ))}

        {/* Dynasty axis line */}
        {activeDynasties.length > 1 && (
          <line
            x1={activeDynasties[0].x}
            y1={dims.h / 2 + 105}
            x2={activeDynasties[activeDynasties.length - 1].x}
            y2={dims.h / 2 + 105}
            stroke="#8A7A6A"
            strokeWidth={0.5}
            opacity={0.25}
          />
        )}

        {/* Connections — rendered below nodes */}
        {connections.map(c => {
          const sourceCompleted = completedIds.has(c.source_id);
          const targetCompleted = completedIds.has(c.target_id);
          const revealed = sourceCompleted || targetCompleted;
          const isNew = newConnectionIds.has(c.id);
          return (
            <Connection
              key={c.id}
              from={positions[c.source_id]}
              to={positions[c.target_id]}
              revealed={revealed}
              isNew={isNew}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map(n => (
          <Node
            key={n.id}
            node={n}
            position={positions[n.id]}
            isCompleted={completedIds.has(n.id)}
            isToday={n.id === todayId}
            onTap={() => onNodeTap(n)}
          />
        ))}
      </g>
    </svg>
  );
}

const s = {
  svg: {
    display: 'block',
    background: '#F5F0E8',
    cursor: 'grab',
    touchAction: 'none',
  },
};
