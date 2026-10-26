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
  author: Person;
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
  playlist: { slug: string; title: string };
  song: { id: string; title: string } | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface PresenceDTO {
  user: Person;
  barId: string | null;
  editing: boolean;
}

export interface PollResult {
  revision: number;
  song: (FullSong & { updatedBy: Person | null }) | null;
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
