import { Button } from '@clickco/ui';
import Play from 'lucide-react-native/icons/play';
import { useOnsiteFlow } from '../hooks';
import { FlowStatus } from './FlowStatus';

/** Checked in: the explicit start (ADR-0013 D2). Waiting is measured until this tap. */
export function StartFooter({ assignmentId }: { assignmentId: string }) {
  const flow = useOnsiteFlow(assignmentId);
  return (
    <>
      <FlowStatus
        flow={flow}
        hint="Start when the client is ready — waiting time counts until you tap Start."
      />
      <Button
        label="Start shoot"
        icon={Play}
        loading={flow.busy}
        onPress={() =>
          void flow.run(async () => {
            await flow.perform({ kind: 'START' });
          })
        }
        testID="start-shoot"
      />
    </>
  );
}
