// src/components/galaxy/useGalaxyData.ts
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  GalaxyBatchResponse,
  GraphNode,
  GraphLink,
  ClusterMeta,
} from './types';

const BATCH_SIZE = 30;

export interface GalaxyGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface UseGalaxyDataReturn {
  graphData: GalaxyGraphData;
  clusterMetas: ClusterMeta[];
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function useGalaxyData(): UseGalaxyDataReturn {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [clusterMetas, setClusterMetas] = useState<ClusterMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const loadedClusterIds = useRef(new Set<number>());

  const mergeBatch = useCallback((data: GalaxyBatchResponse) => {
    const newNodes: GraphNode[] = [];
    const newLinks: GraphLink[] = [];
    const newMetas: ClusterMeta[] = [];

    for (const cluster of data.clusters) {
      if (loadedClusterIds.current.has(cluster.id)) continue;
      loadedClusterIds.current.add(cluster.id);

      const wordIds = new Set(cluster.words.map((w) => w.id));
      newMetas.push({
        id: cluster.id,
        label: cluster.label,
        hue: cluster.hue,
        wordCount: cluster.words.length,
        wordIds,
      });

      for (const word of cluster.words) {
        // If this word is already in the graph from another cluster, skip
        // (multi-cluster words use their first-seen cluster for coloring)
        newNodes.push({
          ...word,
          cluster: String(cluster.id),
          hue: cluster.hue,
          clusterLabel: cluster.label,
        });
      }

      for (const edge of cluster.edges) {
        newLinks.push({
          ...edge,
          hue: cluster.hue,
        });
      }
    }

    setNodes((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      return [...prev, ...newNodes.filter((n) => !existingIds.has(n.id))];
    });
    setLinks((prev) => [...prev, ...newLinks]);
    setClusterMetas((prev) => [...prev, ...newMetas]);
    setHasMore(data.hasMore);
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetch(`/api/galaxy?offset=0&limit=${BATCH_SIZE}`)
      .then((r) => { if (!r.ok) throw new Error(`Galaxy API error ${r.status}`); return r.json(); })
      .then((data: GalaxyBatchResponse) => {
        offsetRef.current = BATCH_SIZE;
        mergeBatch(data);
      })
      .catch((err) => {
        console.error('[useGalaxyData] initial load failed:', err);
        setError(err.message ?? 'Failed to load galaxy data');
      })
      .finally(() => setLoading(false));
  }, [mergeBatch]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const offset = offsetRef.current;
    // Advance offset before fetch to prevent double-trigger if loadMore is called again
    offsetRef.current = offset + BATCH_SIZE;
    fetch(`/api/galaxy?offset=${offset}&limit=${BATCH_SIZE}`)
      .then((r) => { if (!r.ok) throw new Error(`Galaxy API error ${r.status}`); return r.json(); })
      .then((data: GalaxyBatchResponse) => {
        mergeBatch(data);
      })
      .catch((err) => console.error('[useGalaxyData] loadMore failed:', err))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, mergeBatch]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  return {
    graphData,
    clusterMetas,
    loading,
    error,
    loadingMore,
    hasMore,
    loadMore,
  };
}
