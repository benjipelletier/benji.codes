"use client";

// Plain Chinese texts (a book's lessons, an article) into the corpus as
// sentences: pick a .zip of .txt files or the files themselves, name the
// source, see what it would add, then add it. Words never go in the deck
// from here; a sentence becomes readable as its words are learnt.

import { useState } from "react";
import { send } from "@chongfuxi/lib/client";
import { readText, type TextFile } from "@chongfuxi/lib/texts";
import { readZipTexts } from "@chongfuxi/lib/zip";
import { Highlighted, fmt, message, type Shell } from "./shared";

interface Outcome {
  files: number;
  titles: string[];
  found: number;
  tooShort: number;
  repeated: number;
  already: number;
  added: number;
  readable: number;
  samples: Array<{ zh: string; words: string[]; blockers: string[] }>;
  done: boolean;
}

/** "hsk5-kuwen-texts_1.zip" → "hsk5 kuwen texts": a start for the name, to be changed. */
const nameOf = (file: string) =>
  file
    .replace(/\.[^.]+$/, "")
    .replace(/_\d+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

export function TextImport({ shell }: { shell: Shell }) {
  const [files, setFiles] = useState<TextFile[] | null>(null);
  const [source, setSource] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<"reading" | "checking" | "adding" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy("reading");
    setError(null);
    setOutcome(null);
    try {
      const read: TextFile[] = [];
      for (const f of Array.from(list)) {
        if (/\.zip$/i.test(f.name)) read.push(...(await readZipTexts(await f.arrayBuffer())));
        else read.push({ name: f.name, text: await f.text() });
      }
      if (!read.length) throw new Error("No .txt files in that.");
      setFiles(read);
      setSource((s) => s || nameOf(list[0].name));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!files) return;
    setBusy(dryRun ? "checking" : "adding");
    setError(null);
    try {
      const r = await send<Outcome>("texts", { source, files, dryRun });
      setOutcome(r);
      if (!dryRun) shell.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const sentences = files ? files.reduce((n, f) => n + readText(f).sentences.length, 0) : 0;
  return (
    <section className="cf-section cf-texts">
      <h2 className="cf-h2">Texts</h2>
      <p className="cf-lede">
        Lessons or articles in plain Chinese, as .txt files or a .zip of them. Their sentences join the corpus under one
        name and become readable as you learn their words; no words go into your deck.
      </p>

      <label className="cf-btn cf-btn-ghost cf-texts-pick">
        {busy === "reading" ? "Reading…" : files ? "Choose other files" : "Choose files"}
        <input type="file" accept=".zip,.txt,text/plain,application/zip" multiple hidden onChange={(e) => void pick(e.target.files)} />
      </label>

      {files && (
        <>
          <p className="cf-muted">
            {fmt(files.length)} {files.length === 1 ? "file" : "files"}, {fmt(sentences)} sentences.
          </p>
          <label className="cf-texts-name">
            <span>Source name, shown on each sentence's card</span>
            <input
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setOutcome(null);
              }}
              placeholder="HSK标准教程5 课文"
            />
          </label>
          {!outcome && (
            <button className="cf-btn" disabled={busy !== null || !source.trim()} onClick={() => void run(true)}>
              {busy === "checking" ? "Checking…" : "Check what it would add"}
            </button>
          )}
        </>
      )}

      {error && <p className="cf-error">{error}</p>}

      {outcome && (
        <div className="cf-texts-outcome">
          <dl className="cf-arrival-stats">
            <div className={outcome.done ? "is-up" : undefined}>
              <dt>{outcome.done ? "Sentences added" : "New sentences"}</dt>
              <dd>{fmt(outcome.added)}</dd>
            </div>
            <div className="is-up">
              <dt>Readable now</dt>
              <dd>{fmt(outcome.readable)}</dd>
            </div>
            <div>
              <dt>Already there</dt>
              <dd>{fmt(outcome.already)}</dd>
            </div>
          </dl>
          <p className="cf-muted">
            {outcome.readable > 0 &&
              `${fmt(outcome.readable)} ${outcome.done ? "came" : "come"} up as new sentences straight away; the rest wait for their words. `}
            {outcome.tooShort + outcome.repeated > 0 &&
              `${fmt(outcome.tooShort + outcome.repeated)} left out (too short, or the same sentence twice).`}
          </p>
          {outcome.samples.length > 0 && (
            <ul className="cf-texts-samples">
              {outcome.samples.map((s) => (
                <li key={s.zh}>
                  <p className="cf-zh">{s.zh}</p>
                  <p className="cf-muted">
                    {s.words.join(" · ")}
                    {s.blockers.length ? (
                      <>
                        {" "}
                        — waits for <Highlighted text={s.blockers.join(" ")} word={s.blockers[0]} />
                      </>
                    ) : (
                      " — readable"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {outcome.done ? (
            <p className="cf-texts-done">
              Added to the corpus as <b>{source}</b>.{" "}
              <button
                className="cf-link"
                onClick={() => {
                  setFiles(null);
                  setOutcome(null);
                  setSource("");
                }}
              >
                Add more
              </button>
            </p>
          ) : (
            <button className="cf-btn" disabled={busy !== null || outcome.added === 0} onClick={() => void run(false)}>
              {busy === "adding" ? "Adding…" : outcome.added ? `Add ${fmt(outcome.added)} sentences` : "Nothing new to add"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
