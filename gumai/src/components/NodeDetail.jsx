// Detail view for completed nodes (and the reveal after completing a challenge).

const NODE_TYPE_LABELS = {
  chengyu: '成语',
  figure: '历史人物',
  character: '字源',
  concept: '文化概念',
};

export default function NodeDetail({ node, connections, nodeMap, onPanTo }) {
  if (!node) return null;

  const { content, node_type } = node;

  return (
    <div style={s.wrap}>
      {/* Seal stamp header */}
      <div style={s.seal}>
        <span style={s.sealType}>{NODE_TYPE_LABELS[node_type] || node_type}</span>
        <span style={s.sealDynasty}>{node.dynasty}</span>
      </div>

      {node_type === 'chengyu' && <ChengYuDetail content={content} node={node} />}
      {node_type === 'figure' && <FigureDetail content={content} />}
      {node_type === 'character' && <CharacterDetail content={content} />}
      {node_type === 'concept' && <ConceptDetail content={content} />}

      {/* Connections */}
      {connections.length > 0 && (
        <div style={s.connections}>
          <h4 style={s.connTitle}>Connections Revealed</h4>
          {connections.map(c => {
            const linkedId = c.source_id === node.id ? c.target_id : c.source_id;
            const linked = nodeMap[linkedId];
            if (!linked) return null;
            return (
              <button
                key={c.id}
                onClick={() => onPanTo(linkedId)}
                style={s.connItem}
              >
                <span style={s.connChar}>{linked.title}</span>
                <span style={s.connLabel}>{c.label || c.relationship}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChengYuDetail({ content, node }) {
  return (
    <div style={s.content}>
      <p style={s.originStory}>{content.origin_story}</p>
      {content.source_text && (
        <p style={s.sourceText}>— {content.source_text}</p>
      )}
      <div style={s.divider} />
      <p style={s.label}>Modern Usage</p>
      <p style={s.body}>{content.modern_usage}</p>
      <div style={s.exampleBox}>
        <p style={s.exampleChinese}>{content.example_sentence}</p>
        <p style={s.examplePinyin}>{content.example_pinyin}</p>
        <p style={s.exampleEnglish}>{content.example_english}</p>
      </div>
    </div>
  );
}

function FigureDetail({ content }) {
  return (
    <div style={s.content}>
      <p style={s.originStory}>{content.bio}</p>
      <div style={s.divider} />
      <p style={s.label}>Key Contribution</p>
      <p style={s.body}>{content.key_contribution}</p>
      <p style={s.label}>Lesser-Known Fact</p>
      <p style={s.body}>{content.fun_fact}</p>
      {content.related_works?.length > 0 && (
        <>
          <p style={s.label}>Related Works</p>
          <p style={s.body}>{content.related_works.join('、')}</p>
        </>
      )}
    </div>
  );
}

function CharacterDetail({ content }) {
  return (
    <div style={s.content}>
      <p style={s.body}><strong>Meaning:</strong> {content.modern_meaning}</p>
      <p style={s.body}><strong>Radical:</strong> {content.radical}</p>
      <p style={s.originStory}>{content.etymology}</p>
      {content.evolution?.length > 0 && (
        <>
          <div style={s.divider} />
          <p style={s.label}>Evolution</p>
          {content.evolution.map((stage, i) => (
            <p key={i} style={s.evolutionItem}>{stage}</p>
          ))}
        </>
      )}
      {content.derived_characters?.length > 0 && (
        <>
          <div style={s.divider} />
          <p style={s.label}>Derived Characters</p>
          {content.derived_characters.map((d, i) => (
            <p key={i} style={s.evolutionItem}>{d}</p>
          ))}
        </>
      )}
      {content.cultural_note && (
        <>
          <div style={s.divider} />
          <p style={s.body}><em>{content.cultural_note}</em></p>
        </>
      )}
    </div>
  );
}

function ConceptDetail({ content }) {
  return (
    <div style={s.content}>
      <p style={s.originStory}>{content.explanation}</p>
      <div style={s.divider} />
      <p style={s.label}>Historical Roots</p>
      <p style={s.body}>{content.historical_roots}</p>
      <p style={s.label}>Modern Relevance</p>
      <p style={s.body}>{content.modern_relevance}</p>
    </div>
  );
}

const s = {
  wrap: {
    padding: '0 4px 8px',
  },
  seal: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  sealType: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 11,
    color: '#F5F0E8',
    background: '#C23B22',
    padding: '2px 10px',
    borderRadius: 3,
    letterSpacing: '0.05em',
  },
  sealDynasty: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 14,
    color: '#8A7A6A',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  originStory: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 15,
    color: '#2A2A2A',
    lineHeight: 1.7,
    margin: 0,
  },
  sourceText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#8A7A6A',
    margin: 0,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    background: '#D4C8B8',
    margin: '4px 0',
    opacity: 0.6,
  },
  label: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 700,
    fontSize: 11,
    color: '#8A7A6A',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    margin: 0,
  },
  body: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 14,
    color: '#2A2A2A',
    lineHeight: 1.6,
    margin: 0,
  },
  exampleBox: {
    background: 'rgba(0,0,0,0.03)',
    borderLeft: '3px solid #C23B22',
    padding: '10px 14px',
    borderRadius: '0 6px 6px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  exampleChinese: {
    fontFamily: "'Noto Serif SC', serif",
    fontSize: 15,
    color: '#1A1A1A',
    margin: 0,
  },
  examplePinyin: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#6A5A4A',
    margin: 0,
  },
  exampleEnglish: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 13,
    color: '#4A4A4A',
    margin: 0,
  },
  evolutionItem: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 13,
    color: '#4A3A2A',
    margin: 0,
    paddingLeft: 12,
    borderLeft: '2px solid #D4C8B8',
    lineHeight: 1.5,
  },
  connections: {
    marginTop: 20,
    padding: '16px 0 0',
    borderTop: '1px solid #D4C8B8',
  },
  connTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 700,
    fontSize: 11,
    color: '#8A7A6A',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    margin: '0 0 10px',
  },
  connItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid #D4C8B8',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    marginBottom: 8,
    transition: 'background 0.15s',
  },
  connChar: {
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 700,
    fontSize: 18,
    color: '#1A1A1A',
    minWidth: 28,
  },
  connLabel: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#6A5A4A',
    flex: 1,
  },
};
