import { SongPage } from '@ifakepro/components/SongPage';

export default async function Page({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  return <SongPage songId={songId} />;
}
