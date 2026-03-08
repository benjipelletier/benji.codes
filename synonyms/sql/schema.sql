-- Synonym Cluster Graph schema
-- Bipartite graph: Chinese Words ←→ English Gloss Tokens
-- Synonym clusters = projections onto the Chinese word side.
-- Each shared gloss = one edge. More shared glosses = tighter synonyms.

-- ==================== DICTIONARY LAYER ====================

CREATE TABLE words (
    id              SERIAL PRIMARY KEY,
    simplified      TEXT NOT NULL,
    traditional     TEXT,
    pinyin          TEXT NOT NULL,
    pinyin_display  TEXT,
    raw_glosses     TEXT[] NOT NULL,
    hsk_level       INT,
    frequency_rank  INT,
    core_scene      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(simplified, pinyin)
);

CREATE INDEX idx_words_simplified ON words(simplified);
CREATE INDEX idx_words_hsk ON words(hsk_level) WHERE hsk_level IS NOT NULL;

CREATE TABLE gloss_tokens (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    pos_hint        TEXT
);

CREATE INDEX idx_gloss_token ON gloss_tokens(token);

CREATE TABLE word_glosses (
    word_id         INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    gloss_id        INT NOT NULL REFERENCES gloss_tokens(id) ON DELETE CASCADE,
    is_primary      BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (word_id, gloss_id)
);

CREATE INDEX idx_wg_gloss ON word_glosses(gloss_id);
CREATE INDEX idx_wg_word ON word_glosses(word_id);

-- ==================== CLUSTER LAYER ====================

CREATE TABLE synonym_clusters (
    id              SERIAL PRIMARY KEY,
    label           TEXT NOT NULL,
    word_count      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cluster_label ON synonym_clusters(label);

CREATE TABLE cluster_members (
    cluster_id      INT NOT NULL REFERENCES synonym_clusters(id) ON DELETE CASCADE,
    word_id         INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    PRIMARY KEY (cluster_id, word_id)
);

-- Each row = one shared gloss between two words in a cluster.
-- If 摔 and 掉 both map to "fall", that's one row.
-- If they also share "drop", that's a second row.
-- Edge count between a pair = how tightly synonymous they are.
CREATE TABLE synonym_edges (
    id              SERIAL PRIMARY KEY,
    cluster_id      INT NOT NULL REFERENCES synonym_clusters(id) ON DELETE CASCADE,
    word1_id        INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    word2_id        INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    gloss_id        INT NOT NULL REFERENCES gloss_tokens(id) ON DELETE CASCADE,
    UNIQUE(cluster_id, word1_id, word2_id, gloss_id)
);

CREATE INDEX idx_edges_cluster ON synonym_edges(cluster_id);

-- ==================== ENRICHMENT LAYER ====================

CREATE TABLE collocations (
    id              SERIAL PRIMARY KEY,
    word_id         INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    collocation     TEXT NOT NULL,
    pinyin          TEXT,
    gloss           TEXT,
    weight          FLOAT DEFAULT 0.5,
    pattern_type    TEXT,          -- compound, complement, verb-object, modifier, idiom
    source          TEXT DEFAULT 'llm',
    UNIQUE(word_id, collocation)
);

CREATE INDEX idx_coll_word ON collocations(word_id);

-- When a collocation orbits multiple words (e.g. 摔倒 → both 摔 and 倒)
CREATE TABLE collocation_sharing (
    collocation_id  INT NOT NULL REFERENCES collocations(id) ON DELETE CASCADE,
    also_word_id    INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    PRIMARY KEY (collocation_id, also_word_id)
);

CREATE TABLE situations (
    id              SERIAL PRIMARY KEY,
    cluster_id      INT NOT NULL REFERENCES synonym_clusters(id) ON DELETE CASCADE,
    answer_word_id  INT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    situation_en    TEXT NOT NULL,
    explanation     TEXT NOT NULL,
    example_zh      TEXT,
    difficulty      INT DEFAULT 1,  -- 1=obvious, 2=requires thought, 3=tricky
    source          TEXT DEFAULT 'llm',
    UNIQUE(cluster_id, situation_en)
);

CREATE INDEX idx_situations_cluster ON situations(cluster_id);

-- ==================== USER LAYER ====================

CREATE TABLE user_cluster_progress (
    user_id         TEXT NOT NULL,
    cluster_id      INT NOT NULL REFERENCES synonym_clusters(id),
    attempts        INT DEFAULT 0,
    correct         INT DEFAULT 0,
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, cluster_id)
);
