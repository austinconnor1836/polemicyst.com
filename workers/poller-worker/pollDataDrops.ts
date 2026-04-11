import { runDataDropAutomation } from '@shared/lib/data-drop-automation';

export async function pollDataDrops() {
  const result = await runDataDropAutomation();
  console.log(
    `[data-drop] run complete publications=${result.publicationsChecked} snapshots=${result.snapshotsFetched} drafts=${result.draftsCreated}`
  );
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
