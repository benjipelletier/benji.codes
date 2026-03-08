export const DYNASTY_POSITIONS = {
  '夏':     { x: 0,    label: '夏' },
  '商':     { x: 200,  label: '商' },
  '西周':   { x: 400,  label: '西周' },
  '春秋':   { x: 650,  label: '春秋' },
  '战国':   { x: 900,  label: '战国' },
  '秦':     { x: 1100, label: '秦' },
  '西汉':   { x: 1300, label: '西汉' },
  '东汉':   { x: 1500, label: '东汉' },
  '三国':   { x: 1700, label: '三国' },
  '晋':     { x: 1900, label: '晋' },
  '南北朝': { x: 2100, label: '南北朝' },
  '隋':     { x: 2300, label: '隋' },
  '唐':     { x: 2500, label: '唐' },
  '北宋':   { x: 2750, label: '北宋' },
  '南宋':   { x: 2950, label: '南宋' },
  '元':     { x: 3150, label: '元' },
  '明':     { x: 3400, label: '明' },
  '清':     { x: 3650, label: '清' },
  '近现代': { x: 3900, label: '近现代' },
};

export const DYNASTY_ORDER = Object.keys(DYNASTY_POSITIONS);

export function dynastyToX(dynasty) {
  return DYNASTY_POSITIONS[dynasty]?.x ?? 1000;
}

// Sorted unique dynasties that have nodes, for timeline rendering
export function getActiveDynasties(nodes) {
  const seen = new Set();
  const result = [];
  for (const d of DYNASTY_ORDER) {
    if (nodes.some(n => n.dynasty === d) && !seen.has(d)) {
      seen.add(d);
      result.push({ dynasty: d, ...DYNASTY_POSITIONS[d] });
    }
  }
  return result;
}
