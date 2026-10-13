"use client";

// Bringing a Pleco backup in, and deciding what its categories mean.
//
// Nothing is committed until you've seen what it would change: the backup is
// read here in the browser, sorted with the roles you pick, and diffed against
// the present state. Only then does "Import" write it and append the event.

import { useEffect, useMemo, useState } from "react";
import { readPleco, type PlecoSnapshot } from "@chongfuxi/lib/pleco";
import { defaultSettings, topLevelMap, type CategoryRole, type Settings } from "@chongfuxi/lib/corpus";
import type { Effects } from "@chongfuxi/lib/machine";
import { loadSqlJs } from "@chongfuxi/lib/sqljs";
import { newId, sha256, type StoredImport } from "@chongfuxi/lib/store";
import { EffectChips, type AppApi } from "./shared";

export interface ImportMeta {
  id: string;
  at: number;
  fileName: string;
  sha256: string | null;
}

const ROLES: Array<{ value: CategoryRole; label: string }> = [
  { value: "known", label: "Known words" },
  { value: "list", label: "Word list" },
  { value: "sentences", label: "Sentences" },
  { value: "ignore", label: "Ignore" },
];

/** Cards under each top-level category, for the role editor. */
function topCounts(snapshot: PlecoSnapshot): Map<number, number> {
  const topOf = topLevelMap(snapshot.categories);
  const counts = new Map<number, number>();
  for (const card of snapshot.cards) {
    for (const top of new Set(card.cats.map((c) => topOf.get(c) ?? c))) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return counts;
}

/** Keep the roles already chosen for categories that still exist; default the rest. */
function carryOver(snapshot: PlecoSnapshot, prev: Settings | null): Settings {
  const fresh = defaultSettings(snapshot);
  if (!prev) return fresh;
  const roles = { ...fresh.roles };
  for (const id of Object.keys(roles)) if (prev.roles[Number(id)]) roles[Number(id)] = prev.roles[Number(id)];
  return { ...fresh, roles, knownIfScored: prev.knownIfScored, scorefile: prev.scorefile };
}

function RoleEditor({
  snapshot,
  settings,
  onChange,
  disabled,
}: {
  snapshot: PlecoSnapshot;
  settings: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const counts = useMemo(() => topCounts(snapshot), [snapshot]);
  const tops = snapshot.categories
    .filter((c) => settings.roles[c.id] !== undefined)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return (
    <div className="cf-roles">
      {tops.map((c) => (
        <label key={c.id} className="cf-role">
          <span className="cf-role-name">
            {c.name} <span className="cf-muted">{(counts.get(c.id) ?? 0).toLocaleString("en-US")}</span>
          </span>
          <select
            className="cf-select"
            disabled={disabled}
            value={settings.roles[c.id]}
            onChange={(e) =>
              onChange({ ...settings, roles: { ...settings.roles, [c.id]: e.target.value as CategoryRole } })
            }
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="cf-role cf-role-check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={settings.knownIfScored}
          onChange={(e) => onChange({ ...settings, knownIfScored: e.target.checked })}
        />
        <span>Any word with a Pleco score counts as known</span>
      </label>
    </div>
  );
}

function Delta({ fx }: { fx: Effects }) {
  const b = fx.before;
  const a = fx.after;
  if (!a) return null;
  const line = (label: string, from: number | undefined, to: number) => (
    <tr>
      <th scope="row">{label}</th>
      <td>{from === undefined ? "—" : from.toLocaleString("en-US")}</td>
      <td>→</td>
      <td>{to.toLocaleString("en-US")}</td>
    </tr>
  );
  return (
    <table className="cf-table cf-delta">
      <tbody>
        {line("Known words", b?.knownWords, a.knownWords)}
        {line("Readable sentences", b?.unlocked, a.unlocked)}
        {line("One word away", b?.oneAway, a.oneAway)}
        {line("Locked", b?.locked, a.locked)}
      </tbody>
    </table>
  );
}

type Pending = {
  id: string;
  fileName: string;
  sha256: string | null;
  snapshot: PlecoSnapshot;
  settings: Settings;
  duplicateOf: ImportMeta | null;
};

export function ImportPanel({
  api,
  imports,
  currentSnapshot,
  previewImport,
  commitImport,
}: {
  api: AppApi;
  imports: ImportMeta[];
  currentSnapshot: PlecoSnapshot | null;
  previewImport: (id: string, snapshot: PlecoSnapshot, settings: Settings) => Effects;
  commitImport: (record: StoredImport, settings: Settings) => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "committing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fx, setFx] = useState<Effects | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [draftFx, setDraftFx] = useState<Effects | null>(null);

  const readFile = async (file: File) => {
    setError(null);
    setPending(null);
    setStatus("reading");
    try {
      const bytes = await file.arrayBuffer();
      const [hash, SQL] = await Promise.all([sha256(bytes), loadSqlJs()]);
      const db = new SQL.Database(new Uint8Array(bytes));
      let snapshot: PlecoSnapshot;
      try {
        snapshot = readPleco(db);
      } finally {
        db.close();
      }
      setPending({
        id: newId(),
        fileName: file.name,
        sha256: hash,
        snapshot,
        settings: carryOver(snapshot, api.state.settings),
        duplicateOf: (hash && imports.find((i) => i.sha256 === hash)) || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  };

  // Preview a pending import whenever it or its roles change.
  useEffect(() => {
    setFx(null);
    if (!pending) return;
    const handle = window.setTimeout(
      () => setFx(previewImport(pending.id, pending.snapshot, pending.settings)),
      30,
    );
    return () => window.clearTimeout(handle);
  }, [pending, previewImport]);

  // Preview a change of roles on the current import.
  useEffect(() => {
    setDraftFx(null);
    if (!draft) return;
    const handle = window.setTimeout(
      () => setDraftFx(api.preview({ kind: "settings", at: Date.now(), settings: draft })),
      30,
    );
    return () => window.clearTimeout(handle);
    // api.preview is stable per state; re-run only when the draft or state moves.
  }, [draft, api.state]);

  const commit = async () => {
    if (!pending) return;
    setStatus("committing");
    try {
      await commitImport(
        {
          id: pending.id,
          at: Date.now(),
          fileName: pending.fileName,
          sha256: pending.sha256,
          snapshot: pending.snapshot,
        },
        pending.settings,
      );
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  };

  const last = imports[imports.length - 1];

  return (
    <div className="cf-panel">
      <section className="cf-section">
        <h2 className="cf-h2">Import a Pleco backup</h2>
        <p className="cf-lede">
          In Pleco: Flashcards → Import/Export → <b>Backup Database</b>, then pick the <code>.pqb</code> file here.
          It&apos;s read in this browser and stays here.
        </p>
        {last && (
          <p className="cf-muted">
            Last import: {last.fileName}, {new Date(last.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
        {api.readOnly ? (
          <p className="cf-muted">Viewing a past state — return to now to import.</p>
        ) : (
          <label className="cf-file">
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
                e.target.value = "";
              }}
            />
            <span className="cf-btn">{status === "reading" ? "Reading…" : "Choose backup"}</span>
          </label>
        )}
        {error && <p className="cf-error">{error}</p>}
      </section>

      {pending && (
        <section className="cf-section cf-pending">
          <h2 className="cf-h2">{pending.fileName}</h2>
          <p className="cf-muted">
            {pending.snapshot.cards.length.toLocaleString("en-US")} cards,{" "}
            {pending.snapshot.categories.length} categories,{" "}
            {pending.snapshot.scorefiles.map((s) => `scorefile “${s.name}”`).join(", ") || "no scorefile"}
          </p>
          {pending.duplicateOf && (
            <p className="cf-warn">
              This exact file was already imported ({pending.duplicateOf.fileName}). Importing it again changes
              nothing unless you change the roles below.
            </p>
          )}
          <h3 className="cf-h3">What each category is</h3>
          <RoleEditor
            snapshot={pending.snapshot}
            settings={pending.settings}
            onChange={(settings) => setPending({ ...pending, settings })}
          />
          <h3 className="cf-h3">Importing it would</h3>
          {fx ? (
            <>
              <EffectChips fx={fx} />
              <Delta fx={fx} />
            </>
          ) : (
            <p className="cf-muted">Working it out…</p>
          )}
          <div className="cf-buttons">
            <button className="cf-btn cf-btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="cf-btn" disabled={!fx || status === "committing"} onClick={commit}>
              {status === "committing" ? "Importing…" : "Import"}
            </button>
          </div>
        </section>
      )}

      {currentSnapshot && api.state.settings && !pending && (
        <section className="cf-section">
          <h2 className="cf-h2">Categories of the current import</h2>
          <p className="cf-lede">Change what a category means; you&apos;ll see the effect before applying it.</p>
          <RoleEditor
            snapshot={currentSnapshot}
            settings={draft ?? api.state.settings}
            disabled={api.readOnly}
            onChange={setDraft}
          />
          {draft && (
            <>
              <h3 className="cf-h3">This change would</h3>
              {draftFx ? <EffectChips fx={draftFx} /> : <p className="cf-muted">Working it out…</p>}
              <div className="cf-buttons">
                <button className="cf-btn cf-btn-ghost" onClick={() => setDraft(null)}>
                  Discard
                </button>
                <button
                  className="cf-btn"
                  disabled={!draftFx}
                  onClick={async () => {
                    await api.dispatch({ kind: "settings", at: Date.now(), settings: draft });
                    setDraft(null);
                  }}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
