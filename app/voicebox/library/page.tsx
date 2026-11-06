import { TrainerShell } from '@voicebox/components/TrainerShell';
import { LibraryPage } from '@voicebox/components/LibraryPage';

export default function VoicingsLibrary() {
  return (
    <TrainerShell page="library">
      <LibraryPage />
    </TrainerShell>
  );
}
