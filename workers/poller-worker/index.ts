if (process.env.NODE_ENV === 'production') {
  require('module-alias/register');
}
import { pollFeeds } from './pollFeeds';
import { pollDataDrops } from './pollDataDrops';
import './downloadWorker';

async function startPolling() {
  console.log(`[${new Date().toISOString()}] Starting feed polling loop...`);
  const dataDropIntervalMs = Number(process.env.DATA_DROP_POLL_INTERVAL_MS || 15 * 60_000);
  let lastDataDropRunAt = 0;

  setInterval(async () => {
    try {
      await pollFeeds();

      const now = Date.now();
      if (now - lastDataDropRunAt >= dataDropIntervalMs) {
        lastDataDropRunAt = now;
        await pollDataDrops();
      }
    } catch (err) {
      console.error('Feed poller crashed:', err);
    }
  }, 60_000); // Check every minute
}

startPolling();
