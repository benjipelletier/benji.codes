"use client";

// Bringing a newer Pleco backup in, the Anki syncs, and bug reports.
// (Signing in is in the header: components/Account.tsx.)
//
// Words come from Pleco and nowhere else: the owner adds them there, exports a
// backup, and imports it here. The file goes to the server, which turns it
// into rows. Before anything is written the server says what the import would
// add, so it can be looked at first. Importing only ever adds.

import { useEffect, useState } from "react";
import { get, send } from "@chongfuxi/lib/client";
import { uploadFile, type StoredImport } from "@chongfuxi/lib/upload";
import { BugList } from "./BugReport";
import { SyncLog } from "./SyncLog";
import { fmt, message, type Shell } from "./shared";

/** What the server says an import would do, or did. Mirrors IngestSummary on the server. */
interface Outcome {
  fileName: string;
  cards: number;
  words: { total: number; added: number; sample: string[] };
  sentences: { total: number; added: number; readable: number; oneAway: number; unlocked: number };
}

function Importer({ shell }: { shell: Shell }) {
  const [last, setLast] = useState<StoredImport | null>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "weighing" | "ready" | "importing" | "done">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; outcome: Outcome } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ imports: StoredImport[] }>("imports")
      .then((r) => setLast(r.imports.filter((i) => i.ingested !== null).sort((a, b) => b.ingested! - a.ingested!)[0] ?? null))
      .catch(() => undefined);
  }, [step === "done"]);

  const choose = async (file: File) => {
    setError(null);
    setPending(null);
    try {
      setStep("uploading");
      setNote(`Sending ${file.name}…`);
      const id = await uploadFile(file, (sent, total) => setNote(`Sending ${file.name}… ${sent}/${total}`));
      setStep("weighing");
      setNote("Working out what it would add…");
      const outcome = await send<Outcome>(`imports/${encodeURIComponent(id)}/ingest`, {}, "POST", { dry: 1 });
      setPending({ id, outcome });
      setStep("ready");
    } catch (e) {
      setError(message(e));
      setStep("idle");
    } finally {
      setNote(null);
    }
  };

  const commit = async () => {
    if (!pending) return;
    setError(null);
    setStep("importing");
    try {
      const outcome = await send<Outcome>(`imports/${encodeURIComponent(pending.id)}/ingest`, {});
      setPending({ id: pending.id, outcome });
      setStep("done");
      shell.refresh();
    } catch (e) {
      setError(message(e));
      setStep("ready");
    }
  };

  const o = pending?.outcome;
  const busy = step === "uploading" || step === "weighing" || step === "importing";

  return (
    <section className="cf-section">
      <h2 className="cf-h2">Import from Pleco</h2>
      <p className="cf-lede">
        In Pleco: Flashcards → Import/Export → <b>Backup Database</b>, then pick the <code>.pqb</code> file here. New
        words become cards, new sentences join the pool, and nothing you&apos;ve reviewed is touched.
      </p>
      {last && (
        <p className="cf-muted">
          Last import: {last.fileName},{" "}
          {new Date(last.ingested!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}
      <label className="cf-file">
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void choose(f);
            e.target.value = "";
          }}
        />
        <span className="cf-btn">{busy ? "Working…" : "Choose backup"}</span>
      </label>
      {note && <p className="cf-muted">{note}</p>}
      {error && <p className="cf-error">{error}</p>}

      {o && (
        <div className="cf-pending">
          <h3 className="cf-h3">
            {step === "done" ? "Imported" : "Importing it would add"} — {o.fileName}
          </h3>
          <table className="cf-table">
            <tbody>
              <tr>
                <th scope="row">New words</th>
                <td>{fmt(o.words.added)}</td>
              </tr>
              <tr>
                <th scope="row">New sentences</th>
                <td>{fmt(o.sentences.added)}</td>
              </tr>
              <tr>
                <th scope="row">Sentences that become readable</th>
                <td>{fmt(o.sentences.unlocked)}</td>
              </tr>
              <tr className="cf-sub">
                <th scope="row">Words after</th>
                <td>{fmt(o.words.total)}</td>
              </tr>
              <tr className="cf-sub">
                <th scope="row">Readable after</th>
                <td>{fmt(o.sentences.readable)}</td>
              </tr>
            </tbody>
          </table>
          {o.words.sample.length > 0 && <p className="cf-zh">{o.words.sample.join(" ")}{o.words.added > o.words.sample.length ? " …" : ""}</p>}
          {step !== "done" && (
            <div className="cf-buttons">
              <button className="cf-btn cf-btn-ghost" disabled={busy} onClick={() => { setPending(null); setStep("idle"); }}>
                Cancel
              </button>
              <button className="cf-btn" disabled={busy} onClick={commit}>
                {step === "importing" ? "Importing…" : "Import"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ImportPanel({ shell }: { shell: Shell }) {
  const s = shell.summary!;
  return (
    <div className="cf-panel">
      {s.viewer.configured && <SyncLog shell={shell} />}
      {shell.canWrite && <Importer shell={shell} />}
      {s.viewer.configured && <BugList canWrite={shell.canWrite} />}
      {s.viewer.configured && (
        <section className="cf-section">
          <h2 className="cf-h2">About</h2>
          <p className="cf-muted">
            {fmt(s.words)} words and {fmt(s.sentences)} sentences, built from Benji&apos;s Pleco flashcards.{" "}
            {s.retired > 0 && `${fmt(s.retired)} sentences retired. `}
            Definitions are from{" "}
            <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict" target="_blank" rel="noreferrer">
              CC-CEDICT
            </a>
            , CC BY-SA 4.0.
          </p>
        </section>
      )}
    </div>
  );
}
