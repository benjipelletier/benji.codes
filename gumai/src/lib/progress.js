const KEY = 'gumai_progress';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable
  }
}

export function getProgress() {
  const data = load();
  if (!data) {
    return { completedNodes: [], lastVisit: null, firstVisit: null };
  }
  return data;
}

export function markCompleted(nodeId) {
  const data = getProgress();
  if (!data.completedNodes.includes(nodeId)) {
    data.completedNodes.push(nodeId);
  }
  data.lastVisit = new Date().toISOString().slice(0, 10);
  if (!data.firstVisit) data.firstVisit = data.lastVisit;
  save(data);
  return data;
}

export function isCompleted(nodeId) {
  return getProgress().completedNodes.includes(nodeId);
}

export function isFirstVisit() {
  return !load();
}

export function recordVisit() {
  const data = getProgress();
  const today = new Date().toISOString().slice(0, 10);
  if (!data.firstVisit) data.firstVisit = today;
  data.lastVisit = today;
  save(data);
}
