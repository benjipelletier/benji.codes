import { useEffect, useRef, useState } from 'react';

export default function Connection({ from, to, revealed, isNew }) {
  const pathRef = useRef(null);
  const [drawn, setDrawn] = useState(!isNew);

  useEffect(() => {
    if (isNew && revealed && pathRef.current) {
      const length = pathRef.current.getTotalLength();
      pathRef.current.style.strokeDasharray = length;
      pathRef.current.style.strokeDashoffset = length;
      // Trigger animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (pathRef.current) {
            pathRef.current.style.transition = 'stroke-dashoffset 0.8s ease-in-out';
            pathRef.current.style.strokeDashoffset = '0';
          }
          setDrawn(true);
        });
      });
    }
  }, [isNew, revealed]);

  if (!from || !to) return null;

  // Slight quadratic curve for brushstroke feel
  const mx = (from.x + to.x) / 2 + (to.y - from.y) * 0.08;
  const my = (from.y + to.y) / 2 + (from.x - to.x) * 0.08;
  const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

  const opacity = revealed ? 0.45 : 0.08;
  const strokeWidth = revealed ? 1.2 : 0.5;

  return (
    <path
      ref={pathRef}
      d={d}
      stroke="#2A2A2A"
      strokeWidth={strokeWidth}
      fill="none"
      opacity={opacity}
      strokeLinecap="round"
    />
  );
}
