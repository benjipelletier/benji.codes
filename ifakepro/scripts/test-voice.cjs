// Voice edits in a real browser, on a phone: the bar named lights up as it's
// said, the chart changes while they're still talking, and nothing is saved
// until they keep it. The microphone is a stand-in (window.__speech) that
// speaks the way the browser's speech recognition reports: the words so far,
// again and again, growing. Needs the server to reach a model: a real key, or
// ANTHROPIC_BASE_URL pointed at a stand-in that reads "on bar N change X to Y".
//   BASE=http://localhost:3000 ADMIN=benji@example.com node ifakepro/scripts/test-voice.cjs

const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN ?? 'benji@example.com';
const headers = { 'content-type': 'application/json', cookie: `ifp_dev_user=${ADMIN}` };

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/ifakepro${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(j)}`);
  return j;
}

/** A speech recogniser the test speaks through. */
function fakeSpeech() {
  class FakeRecognition {
    constructor() {
      this.lang = 'en-US';
      this.interimResults = true;
      this.continuous = true;
      this.onresult = null;
      this.onend = null;
      this.onerror = null;
    }
    start() {
      window.__speech.live = this;
    }
    stop() {
      if (window.__speech.live !== this) return;
      window.__speech.live = null;
      setTimeout(() => this.onend && this.onend(), 0);
    }
  }
  window.__speech = {
    live: null,
    say(text) {
      const r = window.__speech.live;
      if (!r) throw new Error('not listening');
      const result = [{ transcript: text }];
      result.isFinal = false;
      r.onresult({ results: [result] });
    },
  };
  window.SpeechRecognition = FakeRecognition;
}

(async () => {
  const { slug } = await api('POST', '/playlists', { title: `Voice test ${Date.now()}` });
  const { ids } = await api('POST', `/playlists/${slug}/songs`, { blank: { title: 'Talk To Me', key: 'C' } });
  const id = ids[0];
  const s = await api('GET', `/songs/${id}`);
  const bar = (b, ch) => ({ id: b, events: [{ id: `${b}.0`, at: 0, dur: 96, kind: 'chord', ch }] });
  await api('PATCH', `/songs/${id}`, { baseRevision: s.revision, meta: s.meta, chart: { v: 2, bars: [bar('b1', 'C'), bar('b2', 'F'), bar('b3', 'G'), bar('b4', 'D7'), bar('b5', 'C')] } });
  const saved = async () => api('GET', `/songs/${id}`);
  const rev0 = (await saved()).revision;

  const browser = await chromium.launch();
  const errors = [];
  const step = (x) => console.log(`· ${x}`);
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'ifp_dev_user', value: ADMIN, url: BASE }]);
  await ctx.addInitScript(fakeSpeech);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const bar4 = () => p.locator('.bar').nth(3);

  step('the mic opens from the toolbar');
  await p.goto(`${BASE}/ifakepro/p/${slug}/s/${id}`);
  await p.waitForSelector('.chart');
  await p.click('button:has-text("Voice")');
  await p.waitForSelector('.voice-sheet .voice-dot.on');
  assert.match(await p.locator('.voice-state').innerText(), /Listening/);

  step('“on bar four…” lights up bar 4 straight away');
  await p.evaluate(() => window.__speech.say('on bar four'));
  await p.waitForFunction(() => document.querySelectorAll('.bar')[3]?.classList.contains('sel'), null, { timeout: 1000 });
  assert.equal(await p.locator('.bar.sel').count(), 1);

  step('“…change the D7 to C six” changes the chart while still talking, and saves nothing');
  await p.evaluate(() => window.__speech.say('on bar four change the D7'));
  await p.waitForTimeout(150);
  await p.evaluate(() => window.__speech.say('on bar four change the D7 to C six'));
  await p.waitForFunction(() => /C\s*6/.test(document.querySelectorAll('.bar')[3]?.innerText ?? ''), null, { timeout: 5000 });
  assert.ok(await bar4().evaluate((el) => el.classList.contains('changed')), 'the changed bar is tinted');
  assert.match(await p.locator('.voice-changes').innerText(), /Bar 4: D7 → C6/);
  assert.equal(await p.locator('.voice-sheet .voice-dot.on').count(), 1, 'still listening');
  assert.equal((await saved()).revision, rev0, 'nothing saved while talking');

  step('Done asks to keep the changes; keeping saves them, marked Voice');
  await p.click('.voice-sheet button:has-text("Done")');
  await p.waitForFunction(() => /Keep these changes/.test(document.querySelector('.voice-state')?.textContent ?? ''), null, { timeout: 5000 });
  await p.click('button:has-text("Keep changes")');
  await p.waitForSelector('.voice-sheet', { state: 'detached' });
  const after = await saved();
  assert.equal(after.revision, rev0 + 1);
  assert.equal(after.chart.bars[3].events[0].ch, 'C6');
  assert.equal(after.chart.bars[2].events[0].ch, 'G', 'the other bars are as they were');
  assert.match(await bar4().innerText(), /C\s*6/);
  await p.click('.song-tabbar button:has-text("History")');
  await p.waitForSelector('.v-item .agent-pill');
  assert.match(await p.locator('.v-item').first().innerText(), /✦\s*Voice[\s\S]*“Bar 4: change D7 to C6\.”[\s\S]*Edited bar 4/);
  await p.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } }); // close the sheet again
  await p.waitForSelector('.sheet-scrim', { state: 'detached' });

  step('throwing a voice edit away leaves the song as it was');
  await p.click('button:has-text("Voice")');
  await p.waitForSelector('.voice-sheet .voice-dot.on');
  await p.evaluate(() => window.__speech.say('on bar two change the F to G seven'));
  await p.waitForFunction(() => /G\s*7/.test(document.querySelectorAll('.bar')[1]?.innerText ?? ''), null, { timeout: 5000 });
  await p.click('.voice-sheet button:has-text("Done")');
  await p.waitForFunction(() => /Keep these changes/.test(document.querySelector('.voice-state')?.textContent ?? ''), null, { timeout: 5000 });
  await p.click('button:has-text("Throw away")');
  await p.waitForSelector('.voice-sheet', { state: 'detached' });
  assert.match(await p.locator('.bar').nth(1).innerText(), /^\s*F\s*$/);
  assert.equal((await saved()).revision, rev0 + 1);

  step('no speech recognition: type it instead, same preview and keep');
  const typing = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await typing.addCookies([{ name: 'ifp_dev_user', value: ADMIN, url: BASE }]);
  await typing.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  const d = await typing.newPage();
  d.on('pageerror', (e) => errors.push(e.message));
  await d.goto(`${BASE}/ifakepro/p/${slug}/s/${id}`);
  await d.waitForSelector('.chart');
  await d.click('button:has-text("Voice")');
  await d.fill('.voice-type input', 'on bar five change the C to F six');
  await d.click('.voice-type button:has-text("Go")');
  await d.waitForFunction(() => /Keep these changes/.test(document.querySelector('.voice-state')?.textContent ?? ''), null, { timeout: 5000 });
  assert.match(await d.locator('.bar').nth(4).innerText(), /F\s*6/);
  await d.click('button:has-text("Keep changes")');
  await d.waitForSelector('.voice-sheet', { state: 'detached' });
  assert.equal((await saved()).chart.bars[4].events[0].ch, 'F6');

  step('only editors get the mic');
  const guest = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const g = await guest.newPage();
  await g.goto(`${BASE}/ifakepro/p/${slug}/s/${id}`);
  await g.waitForSelector('.chart');
  assert.equal(await g.locator('button:has-text("Voice")').count(), 0);

  await browser.close();
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('\nall voice checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
