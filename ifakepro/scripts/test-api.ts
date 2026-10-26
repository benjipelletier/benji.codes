// End-to-end checks of iFake Pro's API against a running `next dev` with a
// throwaway database. Uses the development-only ifp_dev_user cookie to act as
// three people: an admin (who must be in IFAKEPRO_ADMIN_EMAILS), an invited
// editor, and a stranger; and their AI agents, with tokens they make.
//   BASE=http://localhost:3000 ADMIN=benji@example.com npx tsx ifakepro/scripts/test-api.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeDocs } from '../lib/merge';
import type { Chart } from '../lib/chart';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN ?? 'benji@example.com';
/** The admin's agent's token, made at the start of the agent checks. */
let agentToken = '';

/** As an AI agent: its bearer token, no cookie. */
async function asAgent(method: string, path: string, body?: unknown, token = agentToken) {
  const res = await fetch(`${BASE}/api/ifakepro${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const agentOk = async (method: string, path: string, body?: unknown) => {
  const r = await asAgent(method, path, body);
  assert.ok(r.status < 300, `agent ${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/ifakepro${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { cookie: `ifp_dev_user=${who}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const ok = async (who: string | null, method: string, path: string, body?: unknown) => {
  const r = await call(who, method, path, body);
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

// Fresh people each run: the server remembers whose profile it has already copied.
const run = Date.now().toString(36);
const ann = `ann.${run}@example.com`;
const eve = `eve.${run}@example.com`;

(async () => {
  const step = (s: string) => console.log(`· ${s}`);

  step('viewer');
  assert.equal((await ok(null, 'GET', '/viewer')).user, null);
  assert.equal((await ok(ADMIN, 'GET', '/viewer')).isAdmin, true);
  assert.equal((await ok(ann, 'GET', '/viewer')).isAdmin, false);

  step('only admins create playlists');
  assert.equal((await call(ann, 'POST', '/playlists', { title: 'Nope' })).status, 403);
  assert.equal((await call(null, 'POST', '/playlists', { title: 'Nope' })).status, 401);

  step('create a playlist from an iReal link');
  const raw = readFileSync(join(__dirname, '../../jazz/charts_raw/jazz.ireal'), 'utf8');
  const preview = await ok(ann, 'POST', '/import', { text: raw });
  assert.equal(preview.songs.length, 1460);
  const { slug } = await ok(ADMIN, 'POST', '/playlists', { title: 'Friday at the Lodge', ireal: raw, include: [0, 1, 2] });
  let pl = await ok(null, 'GET', `/playlists/${slug}`);
  assert.equal(pl.songs.length, 3);
  assert.equal(pl.inviteToken, undefined, 'guests never see the invite token');
  assert.equal(pl.role, null);

  step('add standards and a blank song');
  const hits = (await ok(null, 'GET', '/standards?q=autumn%20leaves')).results;
  assert.equal(hits[0].title, 'Autumn Leaves');
  await ok(ADMIN, 'POST', `/playlists/${slug}/songs`, { standards: [hits[0].index] });
  await ok(ADMIN, 'POST', `/playlists/${slug}/songs`, { blank: { title: 'New Tune', key: 'F' } });
  pl = await ok(ADMIN, 'GET', `/playlists/${slug}`);
  assert.deepEqual(pl.songs.map((s: { meta: { title: string } }) => s.meta.title), ['9.20 Special', '26-2', '52nd Street Theme', 'Autumn Leaves', 'New Tune']);
  assert.ok(pl.inviteToken);

  step('strangers and guests cannot edit');
  const songId = pl.songs[3].id;
  let song = await ok(null, 'GET', `/songs/${songId}`);
  assert.equal((await call(eve, 'PATCH', `/songs/${songId}`, { baseRevision: song.revision, meta: song.meta, chart: song.chart })).status, 403);
  assert.equal((await call(eve, 'POST', `/songs/${songId}/comments`, { body: 'hi' })).status, 403);

  step('joining needs the right token');
  assert.equal((await call(ann, 'POST', `/playlists/${slug}/join`, { token: 'wrong' })).status, 403);
  assert.equal((await ok(ann, 'POST', `/playlists/${slug}/join`, { token: pl.inviteToken })).joined, true);
  assert.equal((await ok(ann, 'GET', `/playlists/${slug}`)).role, 'editor');

  step('save, then a stale save conflicts and merges');
  const base = { meta: song.meta, chart: song.chart as Chart };
  const annDoc = structuredClone(base);
  annDoc.chart.bars[0].events[0].ch = 'C-9';
  const r1 = await ok(ann, 'PATCH', `/songs/${songId}`, { baseRevision: song.revision, ...annDoc });
  assert.equal(r1.revision, song.revision + 1);
  const benDoc = structuredClone(base);
  benDoc.chart.bars[5].events[0].ch = 'D7b9';
  benDoc.meta.bpm = 140;
  const stale = await call(ADMIN, 'PATCH', `/songs/${songId}`, { baseRevision: song.revision, ...benDoc });
  assert.equal(stale.status, 409);
  const merged = mergeDocs(base, benDoc, stale.json.song);
  assert.deepEqual(merged.conflicts, []);
  const r2 = await ok(ADMIN, 'PATCH', `/songs/${songId}`, { baseRevision: stale.json.song.revision, ...merged.value });
  song = await ok(null, 'GET', `/songs/${songId}`);
  assert.equal(song.revision, r2.revision);
  assert.equal(song.chart.bars[0].events[0].ch, 'C-9');
  assert.equal(song.chart.bars[5].events[0].ch, 'D7b9');
  assert.equal(song.meta.bpm, 140);

  step('saves fold into versions per person');
  const again = structuredClone({ meta: song.meta, chart: song.chart as Chart });
  again.chart.bars[1].events[0].ch = 'F9';
  await ok(ann, 'PATCH', `/songs/${songId}`, { baseRevision: song.revision, ...again });
  const versions = (await ok(null, 'GET', `/songs/${songId}/versions`)).versions;
  // import, ann's edit, the admin's edit, ann's second edit (a new version: someone else saved in between)
  assert.equal(versions.length, 4, JSON.stringify(versions.map((v: { summary: string }) => v.summary)));
  assert.equal(versions[3].kind, 'import');
  assert.match(versions[1].summary, /tempo 140/i);

  step('poll sees the change and the other person');
  await ok(ann, 'GET', `/songs/${songId}/poll?rev=0&bar=${song.chart.bars[2].id}&editing=1`);
  const poll = await ok(ADMIN, 'GET', `/songs/${songId}/poll?rev=${song.revision}`);
  assert.ok(poll.song, 'newer revision delivered');
  assert.equal(poll.presence.length, 1);
  assert.match(poll.presence[0].user.name, /^Ann/);
  assert.equal(poll.presence[0].barId, song.chart.bars[2].id);
  const quiet = await ok(ADMIN, 'GET', `/songs/${songId}/poll?rev=${poll.revision}`);
  assert.equal(quiet.song, null);

  step('restore an old version');
  const imported = versions[3];
  await ok(ann, 'PATCH', `/songs/${songId}/versions/${imported.id}`, { label: 'As imported' });
  await ok(ann, 'POST', `/songs/${songId}/versions/${imported.id}`, { action: 'restore' });
  song = await ok(null, 'GET', `/songs/${songId}`);
  assert.equal(song.chart.bars[0].events[0].ch, 'C-7');
  const after = (await ok(null, 'GET', `/songs/${songId}/versions`)).versions;
  assert.equal(after[0].kind, 'restore');
  assert.equal(after[0].summary, 'Restored “As imported”');

  step('comments: thread on a bar, reply, resolve');
  const barId = song.chart.bars[4].id;
  const c1 = await ok(ann, 'POST', `/songs/${songId}/comments`, { body: 'Hold this one', barId });
  await ok(ADMIN, 'POST', `/songs/${songId}/comments`, { body: 'Two beats?', parentId: c1.id });
  const res = await ok(ADMIN, 'PATCH', `/comments/${c1.id}`, { resolved: true });
  assert.equal(res.comments.length, 2);
  assert.ok(res.comments[0].resolvedAt);
  assert.equal(res.comments[1].barId, barId);
  assert.equal((await call(ADMIN, 'PATCH', `/comments/${c1.id}`, { body: 'not mine' })).status, 403);
  assert.ok((await ok(null, 'GET', `/songs/${songId}/poll?rev=999`)).commentsStamp.startsWith('2:'));

  step('activity: per playlist, per song, everywhere');
  const act = (await ok(null, 'GET', `/activity?playlist=${slug}`)).activity;
  const kinds = act.map((a: { kind: string }) => a.kind);
  for (const k of ['playlist.create', 'song.import', 'song.create', 'member.join', 'song.edit', 'song.restore', 'comment.add', 'comment.reply', 'comment.resolve']) {
    assert.ok(kinds.includes(k), `missing ${k}`);
  }
  const songAct = (await ok(null, 'GET', `/activity?song=${songId}`)).activity;
  assert.ok(songAct.every((a: { song: { id: string } }) => a.song?.id === songId));
  assert.ok((await ok(null, 'GET', '/activity')).activity.length >= act.length);

  step('reorder, delete, bring back');
  const order = pl.songs.map((s: { id: string }) => s.id).reverse();
  await ok(ann, 'PATCH', `/playlists/${slug}/songs`, { order });
  pl = await ok(ann, 'GET', `/playlists/${slug}`);
  assert.equal(pl.songs[0].meta.title, 'New Tune');
  await ok(ann, 'DELETE', `/songs/${order[0]}`);
  pl = await ok(ann, 'GET', `/playlists/${slug}`);
  assert.equal(pl.songs.length, 4);
  assert.equal(pl.deletedSongs.length, 1);
  await ok(ann, 'PATCH', `/songs/${order[0]}`, { deleted: false });

  step('a chart stored in the old cell format upgrades on read, and saves as a timeline');
  const legacy = { v: 1, bars: [{ id: 'L1', open: '[', time: '3/4', cells: [{ ch: 'C' }, {}, { ch: 'G7' }, {}] }, { id: 'L2', close: 'Z', cells: [{}, { sym: 'x' }, {}, {}] }] };
  const made = await ok(ADMIN, 'POST', `/playlists/${slug}/songs`, { blank: { title: 'Legacy' } });
  const lid = made.ids[0];
  // Write the old shape straight in, as a song saved before timelines would be.
  const cur = await ok(ADMIN, 'GET', `/songs/${lid}`);
  await call(ADMIN, 'PATCH', `/songs/${lid}`, { baseRevision: cur.revision, meta: cur.meta, chart: legacy });
  const up = await ok(null, 'GET', `/songs/${lid}`);
  assert.equal(up.chart.v, 2);
  assert.deepEqual(up.chart.bars[0].events.map((e: { ch?: string; at: number; dur: number }) => `${e.ch}@${e.at}:${e.dur}`), ['C@0:48', 'G7@48:24'], 'a waltz bar of two chords is 2+1');
  assert.equal(up.chart.bars[1].simile, 1);
  assert.equal(up.chart.bars[0].events[0].id, 'L1.0');

  step('a form starts a new song');
  const blues = await ok(ADMIN, 'POST', `/playlists/${slug}/songs`, { blank: { title: 'Blues in F', key: 'F', form: 'blues' } });
  const bsong = await ok(null, 'GET', `/songs/${blues.ids[0]}`);
  assert.equal(bsong.chart.bars.length, 12);
  assert.equal(bsong.chart.bars[1].events[0].ch, 'Bb7');

  step('export reads back');
  const ex = await ok(null, 'GET', `/playlists/${slug}/export`);
  assert.ok(ex.link.startsWith('irealb://'));
  const back = await ok(null, 'POST', '/import', { text: ex.link });
  assert.equal(back.name, 'Friday at the Lodge');
  assert.equal(back.songs.length, 7);

  step('owner-only settings; rotating the token stops old links');
  assert.equal((await call(ann, 'PATCH', `/playlists/${slug}`, { rotateToken: true })).status, 403);
  await ok(ADMIN, 'PATCH', `/playlists/${slug}`, { rotateToken: true, visibility: 'unlisted' });
  assert.equal((await call(eve, 'POST', `/playlists/${slug}/join`, { token: pl.inviteToken })).status, 403);
  const listed = (await ok(eve, 'GET', '/playlists')).playlists.map((p: { slug: string }) => p.slug);
  assert.ok(!listed.includes(slug), 'unlisted playlists are not listed to strangers');
  assert.ok((await ok(ann, 'GET', '/playlists')).playlists.some((p: { slug: string }) => p.slug === slug), 'but are to members');

  step('copy a song to another playlist');
  const { slug: other } = await ok(ADMIN, 'POST', '/playlists', { title: 'Sunday Brunch' });
  const copy = await ok(ADMIN, 'POST', `/songs/${songId}`, { copyTo: other });
  assert.equal(copy.slug, other);
  assert.equal((await call(ann, 'POST', `/songs/${songId}`, { copyTo: other })).status, 403);

  step('search all songs');
  const found = (await ok(null, 'GET', '/songs?q=autumn')).songs;
  assert.equal(found.length, 1, 'the unlisted original is hidden from guests; the copy is public');
  assert.equal(found[0].playlist.slug, other);

  {
    step('agent · only with its token');
    agentToken = (await ok(ADMIN, 'POST', '/agent-tokens', {})).token;
    assert.equal((await asAgent('GET', '/agent', undefined, 'x'.repeat(agentToken.length))).status, 401);
    assert.equal((await asAgent('GET', '/agent', undefined, '')).status, 401);
    const home = await agentOk('GET', '/agent?q=autumn');
    assert.match(home.brief, /POST \/api\/ifakepro\/agent\/songs\/<id>/);
    const brunch = home.playlists.find((p: { slug: string }) => p.slug === other);
    assert.equal(brunch.songs[0].title, 'Autumn Leaves');
    const id = brunch.songs[0].id;

    step('agent · reads the chart as numbered bars');
    let read = await agentOk('GET', `/agent/songs/${id}`);
    assert.match(read.text, /^Autumn Leaves · key Gm/);
    assert.match(read.text.split('\n')[1], /^ 1 \[A\] \|: Cm7 \| F7 \| Bbmaj7 \| Ebmaj7 \|$/);
    assert.equal(read.bars[4].chords, 'Am7b5');
    const rev0 = read.revision;

    step('agent · a dry run changes nothing; a bad request is refused whole');
    const dry = await agentOk('POST', `/agent/songs/${id}`, { revision: rev0, note: 'try', dryRun: true, ops: [{ op: 'chords', bars: '1-2', text: '| Dm7 G7 | Cmaj7 |' }] });
    assert.equal(dry.summary, 'Edited bars 1–2');
    assert.deepEqual(dry.bars[0], { n: 1, was: 1, before: 'Cm7', after: 'Dm7 G7' });
    const bad = await asAgent('POST', `/agent/songs/${id}`, { revision: rev0, note: 'x', ops: [{ op: 'chords', bars: 1, text: 'Dm7' }, { op: 'put', at: '99:1', what: 'C' }] });
    assert.equal(bad.status, 422);
    assert.match(bad.json.errors[0], /op 2 \(put\): bar 99 doesn’t exist/);
    assert.equal((await agentOk('GET', `/agent/songs/${id}`)).revision, rev0);

    step('agent · an edit is saved as the person, with the agent and its note');
    const done = await agentOk('POST', `/agent/songs/${id}`, {
      revision: rev0,
      note: 'ii–V into the first bar, G7 on beat 3 of bar 4',
      ops: [{ op: 'chords', bars: 1, text: 'Dm7 G7' }, { op: 'put', at: '4:3', what: 'G7', beats: 1 }],
    });
    assert.equal(done.revision, rev0 + 1);
    assert.deepEqual(done.bars.map((b: { n: number }) => b.n), [1, 4]);
    assert.equal(done.bars[1].after, 'Ebmaj7:2 G7:1 Ebmaj7:1');
    let versions = (await ok(null, 'GET', `/songs/${id}/versions`)).versions;
    assert.equal(versions[0].agent, 'Agent');
    assert.equal(versions[0].note, 'ii–V into the first bar, G7 on beat 3 of bar 4');
    assert.equal(versions[0].author.name, 'Benji');
    assert.equal(versions[0].summary, 'Edited bars 1, 4');
    const act = (await ok(null, 'GET', `/activity?playlist=${other}`)).activity;
    assert.equal(act[0].agent, 'Agent');
    const polled = await ok(ADMIN, 'GET', `/songs/${id}/poll?rev=${rev0}`);
    assert.equal(polled.song.agent, 'Agent', 'an open song learns the agent made the change');

    step('agent · a stale revision is a 409 with the song as it is now');
    const stale = await asAgent('POST', `/agent/songs/${id}`, { revision: rev0, note: 'x', ops: [{ op: 'chords', bars: 2, text: 'C' }] });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.song.revision, rev0 + 1);

    step('agent · the person’s own edit right after is a version of its own, and undo won’t clobber it');
    const now = await ok(ADMIN, 'GET', `/songs/${id}`);
    const mine = structuredClone(now);
    mine.meta.bpm = 132;
    await ok(ADMIN, 'PATCH', `/songs/${id}`, { baseRevision: now.revision, meta: mine.meta, chart: mine.chart });
    versions = (await ok(null, 'GET', `/songs/${id}/versions`)).versions;
    assert.equal(versions[0].agent, null);
    assert.equal(versions[1].agent, 'Agent', 'a person’s save never folds into the agent’s version');
    assert.equal((await asAgent('POST', `/agent/songs/${id}/undo`, {})).status, 409);

    step('agent · undo its last edit');
    read = await agentOk('GET', `/agent/songs/${id}`);
    await agentOk('POST', `/agent/songs/${id}`, { revision: read.revision, note: 'up a whole step', ops: [{ op: 'key', key: 'A minor' }] });
    assert.match((await agentOk('GET', `/agent/songs/${id}`)).text, /key Am/);
    const undo = await agentOk('POST', `/agent/songs/${id}/undo`, {});
    assert.equal(undo.undid, 'up a whole step');
    const back = await agentOk('GET', `/agent/songs/${id}`);
    assert.match(back.text, /key Gm/);
    assert.equal(back.bars[0].chords, 'Dm7 G7', 'the earlier edit stays');
    assert.equal(back.history[0].note, 'Undid ‘up a whole step’');

    step('agent · a new song from text or a form');
    const made = await agentOk('POST', `/agent/playlists/${other}/songs`, { title: 'Agent Blues', key: 'F', form: 'blues', note: 'a blues in F for the opener' });
    assert.match(made.text, /^Agent Blues · key F/);
    assert.equal((await ok(null, 'GET', `/songs/${made.id}`)).chart.bars[1].events[0].ch, 'Bb7');
    assert.equal((await ok(null, 'GET', `/songs/${made.id}/versions`)).versions[0].agent, 'Agent');
    const typed = await agentOk('POST', `/agent/playlists/${other}/songs`, { title: 'Vamp', key: 'Eb', text: '| Ebmaj7 | Ab7 | Ebmaj7 | Bb7sus |' });
    assert.equal((await ok(null, 'GET', `/songs/${typed.id}`)).chart.bars.length, 4);
    assert.equal((await asAgent('POST', `/agent/playlists/${other}/songs`, { title: 'Bad', text: '| C D E |' })).status, 422);
    const adminToken = (await ok(ADMIN, 'GET', '/agent-tokens')).tokens.find((t: { prefix: string }) => agentToken.startsWith(t.prefix));
    await ok(ADMIN, 'DELETE', `/agent-tokens/${adminToken.id}`);
  }

  step('agent tokens · each person makes their own, for their own agent');
  assert.equal((await call(null, 'POST', '/agent-tokens', { name: 'Nope' })).status, 401);
  assert.deepEqual((await ok(ann, 'GET', '/agent-tokens')).tokens, []);
  const annToken = await ok(ann, 'POST', '/agent-tokens', { name: 'Ann’s Assistant' });
  assert.match(annToken.token, /^ifp_[\w-]{43}$/);
  const annTokens = (await ok(ann, 'GET', '/agent-tokens')).tokens;
  assert.equal(annTokens.length, 1);
  assert.equal(annTokens[0].name, 'Ann’s Assistant');
  assert.equal(annTokens[0].token, undefined, 'the token itself is only shown once');
  assert.ok(annToken.token.startsWith(annTokens[0].prefix));
  assert.deepEqual((await ok(eve, 'GET', '/agent-tokens')).tokens, [], 'nobody sees anyone else’s');

  step('agent tokens · an agent acts as its person: their playlists, their name, its pill');
  const annHome = (await asAgent('GET', '/agent', undefined, annToken.token)).json;
  assert.equal(annHome.agent, 'Ann’s Assistant');
  assert.deepEqual(annHome.playlists.map((p: { slug: string }) => p.slug), [slug], 'only the playlists Ann has joined');
  const annRead = (await asAgent('GET', `/agent/songs/${songId}`, undefined, annToken.token)).json;
  const annEdit = await asAgent('POST', `/agent/songs/${songId}`, { revision: annRead.revision, agent: 'Someone Else', note: 'swap bar 1', ops: [{ op: 'chords', bars: 1, text: 'Bb7' }] }, annToken.token);
  assert.equal(annEdit.status, 200, JSON.stringify(annEdit.json));
  const annV = (await ok(null, 'GET', `/songs/${songId}/versions`)).versions[0];
  assert.equal(annV.author.id, `dev:${ann}`);
  assert.equal(annV.agent, 'Ann’s Assistant', 'the token’s name, whatever the request says');
  const brunchSong = (await ok(null, 'GET', `/playlists/${other}`)).songs[0].id;
  const brunchRead = await call(ADMIN, 'GET', `/songs/${brunchSong}`);
  assert.equal(
    (await asAgent('POST', `/agent/songs/${brunchSong}`, { revision: brunchRead.json.revision, note: 'x', ops: [{ op: 'chords', bars: 1, text: 'C' }] }, annToken.token)).status,
    403,
    'not a playlist Ann has joined',
  );
  assert.ok((await ok(ann, 'GET', '/agent-tokens')).tokens[0].lastUsedAt, 'last used is recorded');

  step('agent tokens · revoking shuts the agent out at once; only its person can');
  assert.equal((await call(eve, 'DELETE', `/agent-tokens/${annToken.id}`)).status, 404);
  await ok(ann, 'DELETE', `/agent-tokens/${annToken.id}`);
  assert.equal((await asAgent('GET', '/agent', undefined, annToken.token)).status, 401);
  assert.equal((await asAgent('GET', '/agent', undefined, `ifp_${'x'.repeat(43)}`)).status, 401);
  assert.deepEqual((await ok(ann, 'GET', '/agent-tokens')).tokens, []);

  console.log('\nall API checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
