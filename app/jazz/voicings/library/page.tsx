import { TrainerShell } from '@jazz/components/voicings/TrainerShell';
import { LibraryPage } from '@jazz/components/voicings/LibraryPage';

export default function VoicingsLibrary() {
  return (
    <TrainerShell page="library">
      <LibraryPage />
    </TrainerShell>
  );
}
