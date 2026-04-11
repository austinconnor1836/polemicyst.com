if (process.env.NODE_ENV === 'production') {
  require('module-alias/register');
}
import { pollFeeds } from './pollFeeds';
import { startDataDropPolling } from './pollDataDrops';
import './downloadWorker';

async function startPolling() {
  console.log(`[${new Date().toISOString()}] Starting feed polling loop...`);
  const feedPollIntervalMs = Number(process.env.FEED_POLL_INTERVAL_MS || 60_000);

  setInterval(async () => {
    try {
      await pollFeeds();
    } catch (err) {
      console.error('Feed poller crashed:', err);
    }
  }, feedPollIntervalMs);

  // Data-drop automation runs on its own adaptive schedule.
  startDataDropPolling();
}

startPolling();
