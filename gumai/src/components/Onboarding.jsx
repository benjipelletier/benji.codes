export default function Onboarding({ onDismiss }) {
  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <h1 style={s.title}>古脉</h1>
        <p style={s.pinyin}>Gǔ Mài · Ancient Veins</p>

        <div style={s.divider} />

        <p style={s.tagline}>
          A living knowledge map of Chinese history.
          One new node appears each day.
        </p>

        <div style={s.steps}>
          <Step num="一" text="Tap the glowing node to reveal today's challenge" />
          <Step num="二" text="Complete the challenge to unlock its connections" />
          <Step num="三" text="Watch the map grow, day by day, dynasty by dynasty" />
        </div>

        <div style={s.divider} />

        <p style={s.tip}>Pinch to zoom. Drag to pan. The map is the reward.</p>

        <button onClick={onDismiss} style={s.btn}>
          开始 · Begin
        </button>
      </div>
    </div>
  );
}

function Step({ num, text }) {
  return (
    <div style={s.step}>
      <span style={s.stepNum}>{num}</span>
      <p style={s.stepText}>{text}</p>
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(26, 20, 14, 0.75)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    background: '#FAF6EF',
    borderRadius: 16,
    padding: '32px 28px',
    maxWidth: 340,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
  },
  title: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 52,
    color: '#1A1A1A',
    margin: 0,
    letterSpacing: '0.05em',
  },
  pinyin: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 15,
    color: '#8A7A6A',
    margin: '4px 0 0',
  },
  divider: {
    height: 1,
    background: '#D4C8B8',
    margin: '20px 0',
    opacity: 0.6,
  },
  tagline: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 16,
    color: '#2A2A2A',
    lineHeight: 1.6,
    margin: '0 0 20px',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    textAlign: 'left',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  stepNum: {
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 22,
    color: '#C23B22',
    minWidth: 22,
    lineHeight: 1.2,
  },
  stepText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: 15,
    color: '#3A2A1A',
    margin: 0,
    lineHeight: 1.5,
  },
  tip: {
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: 'italic',
    fontSize: 13,
    color: '#8A7A6A',
    margin: 0,
  },
  btn: {
    marginTop: 24,
    background: '#1A1A1A',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 8,
    padding: '14px 40px',
    fontFamily: "'Ma Shan Zheng', serif",
    fontSize: 18,
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
};
