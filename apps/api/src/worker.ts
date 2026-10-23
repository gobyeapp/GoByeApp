import { ConfigError, loadConfig } from './config/config';
import { Database } from './database/database';
import { defaultHandlers, startWorker } from './jobs/worker';

/** Stand-alone job worker (same image, different start command). Run one or more alongside the API. */
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(78);
    }
    throw e;
  }
  const db = Database.fromConfig(config);
  if (!db.configured) {
    process.stderr.write('DATABASE_URL is required for the worker\n');
    process.exit(78);
  }
  const log = (event: string, meta: object) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), service: 'gobye-worker', env: config.APP_ENV, event, ...meta })}\n`);
  const w = startWorker(db, defaultHandlers(), { pollMs: config.WORKER_POLL_MS, concurrency: config.WORKER_CONCURRENCY, log });
  log('worker.started', { workerId: w.workerId });
  const stop = async () => {
    await w.stop();
    await db.close();
    log('worker.stopped', { workerId: w.workerId });
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}

void main();
