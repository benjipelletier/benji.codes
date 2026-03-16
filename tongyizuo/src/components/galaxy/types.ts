// src/components/galaxy/types.ts

export interface GalaxyWord {
  id: string;           // simplified characters — used as node id
  pinyin: string;
  degree: number;
  core_scene: string | null;
  raw_glosses: string[];
}

export interface GalaxyEdge {
  source: string;
  target: string;
  glosses: string[];
  weight: number;
}

export interface GalaxyCluster {
  id: number;
  label: string;
  hue: number;
  words: GalaxyWord[];
  edges: GalaxyEdge[];
}

export interface GalaxyBatchResponse {
  clusters: GalaxyCluster[];
  hasMore: boolean;
}

/** Node shape passed to react-force-graph-2d */
export interface GraphNode extends GalaxyWord {
  cluster: string;      // cluster id as string (for forceCluster key)
  hue: number;
  clusterLabel: string;
  // d3-force adds these at runtime:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/** Link shape passed to react-force-graph-2d */
export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  glosses: string[];
  weight: number;
  hue: number;          // inherited from cluster for coloring
}

/** Per-cluster metadata kept for hull rendering */
export interface ClusterMeta {
  id: number;
  label: string;
  hue: number;
  wordCount: number;
  wordIds: Set<string>;
}
