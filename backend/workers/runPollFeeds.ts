import { pollFeeds } from './pollFeeds';

async function startPolling() {
  console.log(`[${new Date().toISOString()}] Starting feed polling loop...`);

  setInterval(async () => {
    try {
      await pollFeeds();
    } catch (err) {
      console.error('Feed poller crashed:', err);
    }
  }, 60_000); // Check every minute
}

startPolling();
