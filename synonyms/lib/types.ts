// Core types for the synonym cluster graph

export interface WordEntry {
  id: number;
  simplified: string;
  traditional: string | null;
  pinyin: string;
  pinyin_display: string | null;
  raw_glosses: string[];
  hsk_level: number | null;
  core_scene: string | null;
}

export interface CollocationItem {
  collocation: string;
  pinyin: string | null;
  gloss: string | null;
  weight: number;
  pattern_type: string | null;
  shared_with_words: string[];  // simplified chars of other cluster members
}

export interface ClusterMember extends WordEntry {
  collocations: CollocationItem[];
}

export interface EdgeItem {
  word1: string;
  word2: string;
  gloss: string;
}

export interface SituationItem {
  id: number;
  situation_en: string;
  answer_word_id: number;
  explanation: string;
  example_zh: string | null;
  difficulty: number;
}

export interface ClusterData {
  id: number;
  label: string;
  members: ClusterMember[];
  edges: EdgeItem[];
  situations: SituationItem[];
}

export interface ClusterResponse {
  word: {
    id: number;
    simplified: string;
    pinyin_display: string | null;
    raw_glosses: string[];
    core_scene: string | null;
  };
  clusters: ClusterData[];
}

// Raw data from CC-CEDICT (for in-memory index)
export interface CedictEntry {
  simplified: string;
  traditional: string;
  pinyin: string;
  raw_glosses: string[];
  normalized_tokens: string[];
}

// Shape returned by enrichCluster
export interface EnrichmentResult {
  words: Record<string, {
    core_scene: string;
    collocations: Array<{
      phrase: string;
      pinyin: string;
      gloss: string;
      weight: number;
      pattern: string;
      shared_with: string[];
    }>;
  }>;
  situations: Array<{
    scenario: string;
    answer: string;
    why: string;
    example_zh: string;
    difficulty: number;
  }>;
}

// Shape passed into storeCluster
export interface ClusterToStore {
  label: string;
  members: Array<{
    simplified: string;
    traditional: string;
    pinyin: string;
    raw_glosses: string[];
    normalized_tokens: string[];
    core_scene?: string;
    collocations?: Array<{
      phrase: string;
      pinyin: string;
      gloss: string;
      weight: number;
      pattern: string;
      shared_with: string[];
    }>;
  }>;
  edges: Array<{
    word1: string;
    word2: string;
    gloss: string;
  }>;
  situations?: Array<{
    scenario: string;
    answer: string;
    why: string;
    example_zh: string;
    difficulty: number;
  }>;
}
