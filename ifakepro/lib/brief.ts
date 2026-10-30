// What someone's AI agent reads first (GET /api/ifakepro/agent): how to see a
// chart and how to change it. lib/script.ts is the code behind every line.
// The parts a voice edit's model also reads (app/api/ifakepro/voice.ts) are
// shared from here, so the two stay in step.

/** How a chart reads as numbered rows (chartText in lib/script.ts), and how bars and beats are counted. */
export const CHART_LEGEND = `"text" is the chart in rows, as on screen, each row starting with the number of its first bar:
   1 [A] |: Cm7 | F7 | Bbmaj7 | Ebmaj7 |
   5 | Am7b5 | D7b13 | Gm6 | % :|
[A] a section · |: :| a repeat · ‖ a double barline · ‖end the final barline · 1. 2. endings · (3/4) a time change · {segno} {coda} {"Fine"} {fermata on 3} marks · % repeat the last bar · / an empty bar (the chord before carries on).
"bars" has the same per bar: n, section, time, repeat, barline, ending, chords (the bar's text) and events [{beat, beats, kind, chord}].

Bars are numbered 1, 2, 3… in chart order, the numbers the person sees with "# Bars" on. Beats count from 1 in the bar's own meter (eighths in 6/8, 9/8, 12/8); 2.5 or "2+" is the and-of-2, 1.333 a triplet.
If they name a section ("the bridge", "the last A"), find its bars in text and say which bar numbers you changed.`;

/** The Type panel's syntax for a bar's chords. */
export const BAR_TEXT = `Bar text (the same as the app's Type panel): chords separated by spaces share the bar evenly (2 or 4 in 4/4, 3 in 3/4). Give lengths in beats when they don't: "Dm7:3 G7:1", "C:1.5 D:2.5". "/" carries on the chord before: "Dm7 / G7 /". r is a rest, nc is N.C., "C7>" a hit, % repeats the last bar, "C7(b9)" an altered chord, "C7(Db7)" C7 with an alternate chord above. Write chords as you'd say them: Cmaj7, Cm7, Cm7b5, Cdim7, C7sus, C7#9, C6/9, C/E. Three chords in a 4/4 bar without lengths is refused: say which gets two beats.`;

/** The ops applyOps (lib/script.ts) takes. */
export const OPS = `ops (bars: 5, "5-8", "all" or "last"; at: "12:3" for bar 12 beat 3):
  {"op":"chords", "bars":"5-8", "text":"| Dm7 G7 | Cmaj7 | % | A7 |"}   rewrite bars; the bar count must match
  {"op":"put", "at":"12:3", "what":"G7", "beats":1}   one chord (or rest, nc, "/", "G7>") from that beat; without beats it lasts until the next chord. What was sounding before carries on after it.
  {"op":"remove", "at":"12:3"}   the chord that starts there goes; the one before carries on
  {"op":"insert", "after":8, "count":4}   or "before":1; "text":"| … |" fills them, "section":"intro" labels the first
  {"op":"delete", "bars":"9-12"}   section letters, time signatures and repeats on deleted bars move to the bar after
  {"op":"clear", "bars":"9-12"}   empty them, keep the bars
  {"op":"copy", "bars":"1-8", "after":"last"}   or "before":n; copies are new bars
  {"op":"move", "bars":"25-28", "before":1}
  {"op":"transpose", "bars":"5-8", "semitones":2}   leave out bars to move the whole song and its key
  {"op":"key", "key":"Eb", "move":true}   new key; move:false only relabels it
  {"op":"format", "bars":"9-16", "section":"B", "time":"3/4", "ending":1, "repeat":"start|end|both|none", "barline":"double|double-start|final|single", "segno":true, "coda":true, "fermata":"16:1", "text":"Fine", "newLine":true}   any of these; section/ending/text/segno/coda go on the first bar, a closing barline on the last; time applies to just these bars
  {"op":"info", "title":"…", "composer":"…", "style":"Bossa Nova", "bpm":140}`;

export const AGENT_BRIEF = `You edit lead sheets in iFake Pro for the person you work for, when they ask in plain English ("make bars 5-8 a ii-V into C", "put a G7 on beat 3 of bar 12", "add a 4-bar intro", "take it down a whole step"). Your edits are saved as theirs, with your name on a pill beside them in the version history, and anyone with the song open sees them in a few seconds.

Send Authorization: Bearer <token> with every request.

READ
GET /api/ifakepro/agent?q=<title>        playlists and their songs (id, title, key, bars, revision, url)
GET /api/ifakepro/agent/songs/<id>       one song: revision, meta, text, bars, recent history

${CHART_LEGEND}

CHANGE
POST /api/ifakepro/agent/songs/<id>
{ "revision": <the revision you read>, "note": "<what they asked, in a few words>", "ops": [ … ], "dryRun": false }

Every number in a request means the chart as you read it at that revision, even after an insert earlier in the same request. All ops apply or none do: any problem refuses the whole request with a message per op, and nothing changes. If someone edited since you read it you get 409 with the song as it is now: read it again and redo the request. Use "dryRun": true to see the result without saving, for bigger edits or when unsure.

${BAR_TEXT}

${OPS}

The answer has the new revision, a summary ("Edited bars 5–8"), "bars" [{n, was, before, after}] for each changed bar, "removed" (old numbers), the new text, and the song's url. Tell the person what changed in a sentence, by bar number.

POST /api/ifakepro/agent/songs/<id>/undo   puts back the song as it was before your last edit, if nobody has edited it since (409 otherwise)

NEW SONG
POST /api/ifakepro/agent/playlists/<slug>/songs
{ "title": "…", "key": "F", "time": "4/4", "form": "empty|blues|jazzblues|aaba|abac", "bars": 32, "text": "| … |", "composer": "…", "style": "…", "bpm": 0, "note": "…" }
text (or a form) gives the chords; without either it's "bars" empty bars (16 if not given).

Examples
"make the last 4 bars of the A a ii-V-I into Bb" (A is bars 1-8):
  [{"op":"chords","bars":"5-8","text":"| Cm7 | F7 | Bbmaj7 | Bbmaj7 |"}]
"G7 on the and of 2 in bar 3, just for a beat":
  [{"op":"put","at":"3:2+","what":"G7","beats":1}]
"add a 4-bar intro vamping on the I and V":
  [{"op":"insert","before":1,"text":"| C | G7 | C | G7 |","section":"intro"}]
"repeat the bridge" (bridge is bars 17-24): [{"op":"format","bars":"17-24","repeat":"both"}]
"put it in Eb for the horns": [{"op":"key","key":"Eb"}]`;
