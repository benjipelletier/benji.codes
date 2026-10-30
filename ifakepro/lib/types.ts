// What the API sends, shared by the routes and the pages.

import type { Chart, SongMeta } from './chart';

/** Anyone shown in the app. Emails are only ever sent to the playlist's owner. */
export interface Person {
  id: string;
  name: string;
  image: string | null;
}

export interface Viewer {
  user: (Person & { email: string }) | null;
  isAdmin: boolean;
}

export type Role = 'owner' | 'editor';

export interface PlaylistSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  visibility: 'public' | 'unlisted';
  songCount: number;
  updatedAt: string;
  owner: Person;
  role: Role | null;
}

export interface SongSummary {
  id: string;
  meta: SongMeta;
  revision: number;
  updatedAt: string;
  updatedBy: Person | null;
  openComments: number;
  bars: number;
}

export interface Member extends Person {
  role: Role;
  email?: string;
  joinedAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  songs: SongSummary[];
  /** Members only. */
  deletedSongs?: SongSummary[];
  inviteToken?: string;
  members?: Member[];
}

export interface SongDetail {
  id: string;
  playlist: { id: string; slug: string; title: string; role: Role | null };
  meta: SongMeta;
  chart: Chart;
  revision: number;
  updatedAt: string;
  updatedBy: Person | null;
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  deleted: boolean;
}

export interface FullSong {
  id: string;
  meta: SongMeta;
  chart: Chart;
  revision: number;
}

export interface VersionSummary {
  id: string;
  revision: number;
  kind: 'create' | 'import' | 'edit' | 'restore' | 'copy';
  summary: string;
  label: string | null;
  /** The person it was for, or who made it. */
  author: Person;
  /** Set when someone's AI agent made it, acting for the author: its name. */
  agent: string | null;
  /** What the agent was asked to do, in its words. */
  note: string | null;
  startedAt: string;
  createdAt: string;
}

export interface VersionDetail extends VersionSummary {
  meta: SongMeta;
  chart: Chart;
}

export interface CommentDTO {
  id: string;
  barId: string | null;
  parentId: string | null;
  body: string;
  author: Person;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: Person | null;
}

export interface ActivityDTO {
  id: string;
  kind: string;
  summary: string;
  actor: Person;
  /** Set when the actor's AI agent did it for them: its name. */
  agent: string | null;
  playlist: { slug: string; title: string };
  song: { id: string; title: string } | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/** A token someone made for their own agent. The token itself is only ever shown once, when it's made. */
export interface AgentToken {
  id: string;
  /** The agent's name, on the pill beside its edits. */
  name: string;
  /** The token's first characters, to tell them apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What a voice edit heard so far, and the edits it makes (POST /songs/[id]/voice). */
export interface VoiceResult {
  /** What they said, tidied into one sentence of instructions. */
  heard: string;
  /** The bars the latest words are about. */
  focus: number[];
  ops: Record<string, unknown>[];
  /** One line per change, "Bar 4: D7 → C6". */
  summary: string[];
  /** Still mid-instruction. */
  unfinished: boolean;
  /** Edits the chart refused, and why. */
  errors: string[];
  /** The chart with the edits, to preview; null when there are none yet. */
  preview: { meta: SongMeta; chart: Chart } | null;
  changes: { bars: { n: number; was: number | null; before: string | null; after: string }[]; removed: number[] } | null;
}

export interface PresenceDTO {
  user: Person;
  barId: string | null;
  editing: boolean;
}

export interface PollResult {
  revision: number;
  song: (FullSong & { updatedBy: Person | null; agent: string | null }) | null;
  presence: PresenceDTO[];
  /** Changes whenever any comment on the song changes. */
  commentsStamp: string;
  deleted: boolean;
}

export interface StandardHit {
  index: number;
  title: string;
  composer: string;
  style: string;
  key: string;
  bars: number;
}

export interface ImportPreview {
  name: string | null;
  songs: { title: string; composer: string; style: string; key: string; bars: number }[];
  failed: { title: string; reason: string }[];
}
