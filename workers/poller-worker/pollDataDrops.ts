import { runDataDropAutomation } from '@shared/lib/data-drop-automation';
import { describeActiveWindows, resolveDataDropCadence } from '@shared/lib/data-drop-schedule';

export async function pollDataDrops() {
  const result = await runDataDropAutomation();
  console.log(
    `[data-drop] run complete publications=${result.publicationsChecked} snapshots=${result.snapshotsFetched} drafts=${result.draftsCreated}`
  );
}

let dataDropTimer: NodeJS.Timeout | null = null;

export function startDataDropPolling() {
  if (dataDropTimer) {
    console.log('[data-drop] scheduler already running, skipping duplicate start');
    return;
  }

  const runLoop = async () => {
    const cadence = resolveDataDropCadence();
    const windows = describeActiveWindows(cadence);
    console.log(
      `[data-drop] scheduler mode=${cadence.mode} intervalMs=${cadence.intervalMs}${
        windows ? ` windows=${windows}` : ''
      }`
    );

    try {
      await pollDataDrops();
    } catch (error) {
      console.error('[data-drop] scheduled run failed:', error);
    } finally {
      dataDropTimer = setTimeout(runLoop, cadence.intervalMs);
    }
  };

  void runLoop();
}

async function runFromCli() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const skipDatabase = args.has('--skip-db');
  const publicationArg = process.argv.find((arg) => arg.startsWith('--publication='));
  const publicationId = publicationArg ? publicationArg.split('=')[1] : undefined;

  const result = await runDataDropAutomation({
    dryRun,
    skipDatabase,
    publicationId,
  });

  console.log(
    `[data-drop] CLI result publications=${result.publicationsChecked} snapshots=${result.snapshotsFetched} drafts=${result.draftsCreated}`
  );
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error('[data-drop] CLI run failed:', error);
    process.exit(1);
  });
}
