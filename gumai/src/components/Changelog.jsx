export default function Changelog({ entries, onClose }) {
  return (
    <>
      <div style={s.backdrop} onClick={onClose} />
      <div style={s.panel}>
        <div style={s.header}>
          <h2 style={s.title}>古脉年鉴</h2>
          <span style={s.subtitle}>Chronicle of Ancient Veins</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        <div style={s.scroll}>
          {entries.length === 0 && (
            <p style={s.empty}>The chronicle is empty. Complete a challenge to begin.</p>
          )}
          {entries.map((e, i) => (
            <div key={i} style={s.entry}>
              <div style={s.entryMeta}>
                <span style={s.entryTitle}>{e.node_title}</span>
                <span style={s.entryDay}>Day {e.day_number}</span>
              </div>
              <p style={s.entryText}>{e.entry}</p>
              <p style={s.entryDate}>{e.date}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const s = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(26, 20, 14, 0.4)',
    zIndex: 30,
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 'min(360px, 100vw)',
    background: '#FAF6EF',
    boxShadow: '-4px 0 30px rgba(0,0,0,0.15)',
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '24px 20px 16px',
    borderBottom: '1px solid #D4C8B8',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    position: 'relative',
  },
  title: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 26,
    color: '#1A1A1A',
    margin: 0,
  },
  subtitle: {
    fontFamily: "'Playfair Display', serif",
    fontStyle: 'italic',
    fontSize: 12,
    color: '#8A7A6A',
  },
  closeBtn: {
    position: 'absolute',
    top: 20,
    right: 16,
    background: 'none',
    border: 'none',
    fontSize: 16,
    color: '#8A7A6A',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  scroll: {
    overflowY: 'auto',
    padding: '16px 20px 32px',
    flex: 1,
  },
  empty: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 14,
    color: '#8A7A6A',
    textAlign: 'center',
    marginTop: 40,
  },
  entry: {
    borderBottom: '1px solid #E8E0D4',
    paddingBottom: 20,
    marginBottom: 20,
  },
  entryMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  entryTitle: {
    fontFamily: "'Noto Serif SC', serif",
    fontWeight: 700,
    fontSize: 20,
    color: '#1A1A1A',
  },
  entryDay: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 12,
    color: '#8A7A6A',
    letterSpacing: '0.05em',
  },
  entryText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 15,
    color: '#3A2A1A',
    lineHeight: 1.7,
    margin: '0 0 8px',
  },
  entryDate: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 11,
    color: '#A89A8A',
    margin: 0,
    textAlign: 'right',
  },
};
