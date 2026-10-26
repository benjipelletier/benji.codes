'use client';

// "Your agent": tokens a person makes for their own AI agent (their Muse), so
// it can edit charts in the playlists they've joined when they ask it in
// plain English. The token is shown once, with a note to paste to the agent.

import { useEffect, useState } from 'react';
import { api, copyText, timeAgo } from '@ifakepro/lib/client';
import type { AgentToken } from '@ifakepro/lib/types';
import { AgentPill, Dialog, Spinner, useToast } from './ui';

/** What to tell the agent: where to start, and its token. */
function agentNote(token: string, name: string): string {
  const base = `${window.location.origin}/api/ifakepro/agent`;
  return [
    `You can edit my chord charts on iFake Pro. Your name there is “${name}”.`,
    `Send this header with every request: Authorization: Bearer ${token}`,
    `Start with GET ${base} — it explains how to read and change charts (bars by number, beats by number) and lists the songs you can edit.`,
    'When I ask for a change in plain English, read the song, make the change, put what I asked in the note, and tell me which bar numbers changed.',
  ].join('\n');
}

export function AgentTokensDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [name, setName] = useState('Muse');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<(AgentToken & { token: string }) | null>(null);

  useEffect(() => {
    api<{ tokens: AgentToken[] }>('/agent-tokens').then((r) => setTokens(r.tokens)).catch(() => setTokens([]));
  }, []);

  const make = async () => {
    setBusy(true);
    try {
      const t = await api<AgentToken & { token: string }>('/agent-tokens', { body: { name } });
      setMade(t);
      setTokens((ts) => [t, ...(ts ?? [])]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t make a token', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (t: AgentToken) => {
    if (!window.confirm(`Revoke ${t.name}’s token (${t.prefix}…)? An agent using it stops working at once.`)) return;
    await api(`/agent-tokens/${t.id}`, { method: 'DELETE' });
    setTokens((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
    if (made?.id === t.id) setMade(null);
    toast('Token revoked');
  };
  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : 'Couldn’t copy; select it and copy by hand');

  return (
    <Dialog title="Your agent" onClose={onClose}>
      <div className="share agent-tokens">
        <section>
          <p>
            Give your AI agent (like Muse) a token, and you can ask it in plain English to change charts in the playlists you’ve joined: “make bars 5–8 a ii–V into C”, “put it in Eb”.
          </p>
          <p className="muted">
            Its edits are saved as yours, with its name beside them: <b>You</b> <AgentPill name={name.trim() || 'Muse'} />. It can do what you can, nothing more. Revoke a token to shut it out.
          </p>
        </section>

        {made ? (
          <section className="agent-made">
            <h3>{made.name}’s token</h3>
            <p className="muted">Copy it now: it won’t be shown again.</p>
            <div className="linkbox">
              <input readOnly value={made.token} onFocus={(e) => e.target.select()} aria-label="Agent token" />
              <button className="ifp-btn small" onClick={() => copy(made.token, 'Token')}>Copy</button>
            </div>
            <button className="ifp-btn primary" onClick={() => copy(agentNote(made.token, made.name), 'Note for your agent')}>
              Copy a note for {made.name}
            </button>
            <p className="muted">The note tells your agent where to start and includes the token. Paste it into your chat with {made.name}.</p>
          </section>
        ) : (
          <section>
            <h3>Make a token</h3>
            <div className="linkbox">
              <input className="agent-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} aria-label="Your agent’s name" placeholder="Muse" />
              <button className="ifp-btn small primary" onClick={make} disabled={busy}>Make token</button>
            </div>
            <p className="muted">The name goes on the pill beside its edits.</p>
          </section>
        )}

        <section>
          <h3>Tokens</h3>
          {!tokens ? (
            <Spinner />
          ) : !tokens.length ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="members">
              {tokens.map((t) => (
                <li key={t.id}>
                  <AgentPill name={t.name} />
                  <div>
                    <code>{t.prefix}…</code>
                    <div className="muted small">
                      made {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'not used yet'}
                    </div>
                  </div>
                  <button className="ifp-link danger" onClick={() => revoke(t)}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
