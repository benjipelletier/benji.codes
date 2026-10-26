// End-to-end checks of the chart editor in a real browser, on a phone-sized
// screen (touch) and a laptop (mouse and keyboard). Needs Playwright and a
// running `next dev` with a throwaway database, the same setup as test-api.ts:
//   BASE=http://localhost:3000 ADMIN=benji@example.com node ifakepro/scripts/test-editor.cjs
//
// It builds a tune from scratch by typing a progression, then edits it the
// ways a musician would: change a chord by tapping, add a one-beat chord,
// put in a rest, drag a boundary, undo and redo, insert / duplicate / delete
// bars, transpose a bar, and checks after each step what the server saved.

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

/** "D-7@0:48 rest@48:24" for bar i of the saved chart. */
const tl = (chart, i) => chart.bars[i].events.map((e) => `${e.kind === 'chord' ? e.ch : e.kind}@${e.at}:${e.dur}`).join(' ');

(async () => {
  const { slug } = await api('POST', '/playlists', { title: `Editor test ${Date.now()}` });
  const { ids } = await api('POST', `/playlists/${slug}/songs`, { blank: { title: 'From Scratch', key: 'Bb', form: 'empty' } });
  const songId = ids[0];
  const saved = async () => (await api('GET', `/songs/${songId}`)).chart;

  const browser = await chromium.launch();
  const errors = [];
  const step = (s) => console.log(`· ${s}`);

  // ---------------------------------------------------------------- phone
  const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.addCookies([{ name: 'ifp_dev_user', value: ADMIN, url: BASE }]);
  const p = await phone.newPage();
  p.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  const settle = async () => {
    await p.waitForFunction(() => document.querySelector('.save')?.textContent === 'Saved', null, { timeout: 8000 });
  };
  const noOverflow = async (where) => {
    const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(o <= 0, `${where}: page scrolls sideways by ${o}px`);
  };
  const tapBar = async (i, frac = 0.25) => {
    // Like a person would: scroll the bar into the part of the screen the sheet doesn't cover first.
    await p.locator('.bar').nth(i).evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - 140 }));
    await p.waitForTimeout(100);
    const box = await p.locator('.bar').nth(i).boundingBox();
    await p.touchscreen.tap(box.x + box.width * frac, box.y + box.height * 0.6);
    await p.waitForTimeout(150);
  };
  const tab = async (name) => {
    await p.click(`.ed-tabs button:has-text("${name}")`);
    await p.waitForTimeout(120);
  };

  step('a new song opens straight into the editor');
  await p.goto(`${BASE}/ifakepro/p/${slug}/s/${songId}?edit=1`);
  await p.waitForSelector('.ed-sheet');
  await noOverflow('editor open');

  step('type a whole progression in, with a flagged bar left alone until fixed');
  await p.click('.ed-sheet button:has-text("Type chords")');
  await p.fill('.ed-text', '| Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 D7(b9) | Gm6 | C D E |');
  await p.waitForSelector('.ed-flags');
  assert.match(await p.locator('.ed-flags').innerText(), /Bar 7: 3 chords/);
  await p.fill('.ed-text', '| Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 D7(b9) | Gm6 |');
  assert.equal(await p.locator('.ed-flags').count(), 0);
  await p.click('.ed-sheet button:has-text("Replace")');
  await settle();
  let c = await saved();
  assert.equal(c.bars.length, 6);
  assert.deepEqual(c.bars.map((_, i) => tl(c, i)), ['C-7@0:96', 'F7@0:96', 'Bb^7@0:96', 'Eb^7@0:96', 'Ah7@0:48 D7b9@48:48', 'G-6@0:96']);
  await noOverflow('type tab');

  step('acceptance 1 · tap a chord, change its root, then its quality; neighbours untouched');
  await tapBar(0);
  await tab('Chord');
  await p.locator('.ed-roots').first().locator('.ed-root', { hasText: /^D$/ }).click();
  await p.locator('.ed-q', { hasText: /^7$/ }).click();
  await settle();
  c = await saved();
  assert.equal(tl(c, 0), 'D7@0:96');
  assert.equal(tl(c, 1), 'F7@0:96');
  await noOverflow('chord tab');

  step('acceptance 2 · a one-beat chord on beat 4 (rhythm mode, + mark, typed chord)');
  await tapBar(1);
  await tab('Rhythm');
  await p.waitForSelector('.tl-add');
  const adds = p.locator('.tl-add');
  await adds.nth((await adds.count()) - 1).click(); // the last grid line: beat 4
  await tab('Chord');
  await p.fill('.ed-input', 'C7');
  await settle();
  c = await saved();
  assert.equal(tl(c, 1), 'F7@0:72 C7@72:24');
  await noOverflow('rhythm tab');

  step('acceptance 3 · a rest on beat 3, distinct from "no change"');
  await tapBar(2);
  await tab('Rhythm');
  await p.click('.ed-btn:has-text("Split into beats")');
  await p.click('.tl-ev >> nth=2');
  await p.click('.ed-kinds .ed-btn:has-text("Rest")');
  await settle();
  c = await saved();
  assert.equal(tl(c, 2), 'Bb^7@0:24 hold@24:24 rest@48:24 hold@72:24');
  assert.ok(await p.locator('.bar >> nth=2 >> .rest').count(), 'the rest is drawn');

  step('acceptance 4 & 5 · drag a boundary (snaps to the beat, can’t cross a neighbour)');
  await tapBar(4, 0.2);
  await tab('Rhythm');
  await p.waitForTimeout(400); // the sheet grows for the ruler; measure once it has
  const handle = p.locator('.tl-handle').first();
  const hb = await handle.boundingBox();
  const track = await p.locator('.tl-track').boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(track.x + track.width * 0.77, hb.y + hb.height / 2, { steps: 6 });
  await p.mouse.up();
  if (process.env.DEBUG) console.log('   timeline after drag:', JSON.stringify(await p.locator('.tl-ev').allInnerTexts()), 'where:', await p.locator('.ed-where').innerText(), JSON.stringify(hb), JSON.stringify(track));
  await settle();
  c = await saved();
  assert.equal(tl(c, 4), 'Ah7@0:72 D7b9@72:24');
  await p.mouse.move(hb.x + hb.width / 2, hb.y + 5);

  step('acceptance 7 · undo and redo');
  await p.click('.ed-head button[aria-label="Undo"]');
  await settle();
  assert.equal(tl(await saved(), 4), 'Ah7@0:48 D7b9@48:48');
  await p.click('.ed-head button[aria-label="Redo"]');
  await settle();
  assert.equal(tl(await saved(), 4), 'Ah7@0:72 D7b9@72:24');

  step('acceptance 11 · switching panels changes nothing');
  const before = JSON.stringify(await saved());
  for (const t of ['Chord', 'Rhythm', 'Bar', 'Type', 'Chord']) {
    await tab(t);
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1200);
  assert.equal(JSON.stringify(await saved()), before);

  step('acceptance 6 · insert, duplicate and delete bars');
  await tapBar(5);
  await tab('Bar');
  await p.click('.ed-btn:has-text("Duplicate")');
  await settle();
  c = await saved();
  assert.equal(c.bars.length, 7);
  assert.equal(tl(c, 6), 'G-6@0:96');
  await p.click('.ed-btn:has-text("Delete")');
  await settle();
  assert.equal((await saved()).bars.length, 6);
  await p.click('.ed-btn:has-text("+ After")');
  await settle();
  c = await saved();
  assert.equal(c.bars.length, 7);
  assert.equal(tl(c, 6), 'hold@0:96');
  await noOverflow('bar tab');

  step('acceptance 8 · transpose one bar up a half step, quality and alteration kept');
  await tapBar(4, 0.2);
  await tab('Bar');
  await p.click('.ed-btn:has-text("+½ step")');
  await settle();
  c = await saved();
  assert.equal(tl(c, 4), 'Bbh7@0:72 Eb7b9@72:24');

  step('Done returns to a clean reading view; the chart reloads the same');
  await p.click('.ed-done');
  assert.equal(await p.locator('.ed-sheet').count(), 0);
  assert.equal(await p.locator('.bar-no').count(), 0, 'no bar numbers when reading');
  await p.reload();
  await p.waitForSelector('.chart');
  assert.match(await p.locator('.bar').nth(1).innerText(), /F\s*7[\s\S]*C\s*7/);
  await phone.close();

  // ---------------------------------------------------------------- laptop: keyboard
  const lap = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await lap.addCookies([{ name: 'ifp_dev_user', value: ADMIN, url: BASE }]);
  const d = await lap.newPage();
  d.on('pageerror', (e) => errors.push(`laptop: ${e.message}`));
  await d.goto(`${BASE}/ifakepro/p/${slug}/s/${songId}`);
  await d.waitForSelector('.chart');

  step('laptop · click a bar, type a chord, Enter moves on, r makes a rest');
  await d.locator('.bar').nth(6).click();
  await d.waitForSelector('.ed-sheet');
  await d.keyboard.type('Gm7');
  await d.keyboard.press('Enter');
  await d.waitForTimeout(100);
  await d.keyboard.type('C7');
  await d.keyboard.press('Escape');
  await d.locator('.chart').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await d.waitForFunction(() => document.querySelector('.save')?.textContent === 'Saved', null, { timeout: 8000 });
  c = await saved();
  assert.equal(tl(c, 6), 'G-7@0:96');
  assert.equal(c.bars.length, 8, 'Enter past the last bar adds one');
  assert.equal(tl(c, 7), 'C7@0:96');
  await d.keyboard.press('ArrowLeft');
  await d.keyboard.press('s');
  await d.keyboard.press('ArrowRight');
  await d.keyboard.press('r');
  await d.waitForFunction(() => document.querySelector('.save')?.textContent === 'Saved', null, { timeout: 8000 });
  c = await saved();
  assert.match(tl(c, 6), /^G-7@0:48 rest@48:48$/);
  await d.keyboard.press('Meta+z');
  await d.keyboard.press('Control+z');
  await lap.close();

  await browser.close();
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('\nall editor checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
