import { TrainerShell } from '@voiceshed/components/TrainerShell';
import { ListenPage } from '@voiceshed/components/ListenPage';

export default function VoicingsListen() {
  return (
    <TrainerShell page="listen">
      <ListenPage />
    </TrainerShell>
  );
}
