import 'reflect-metadata';
import { ConfigError, loadConfig } from './config/config';
import { createApp, depsFromConfig } from './app.factory';
import { defaultHandlers, startWorker } from './jobs/worker';
import { whatsappHandlers } from './whatsapp/whatsapp.service';

/** HTTP server. Listens on PORT (default 8080). Optionally runs the job worker in-process (WORKER_ENABLED). */
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(78); // EX_CONFIG: the host shows a failed deploy instead of a crash loop with no reason
    }
    throw e;
  }
  const deps = depsFromConfig(config);
  const app = await createApp(deps);
  await app.listen({ host: config.HOST, port: config.PORT });

  const worker = config.WORKER_ENABLED && deps.db.configured
    ? startWorker(deps.db, { ...defaultHandlers(), ...whatsappHandlers({ config, providers: deps.providers }) }, {
        pollMs: config.WORKER_POLL_MS,
        concurrency: config.WORKER_CONCURRENCY,
        log: (m, meta) => app.getHttpAdapter().getInstance().log.info({ ...meta, event: m }),
      })
    : null;

  // Graceful stop on SIGTERM (deploys): stop taking jobs, finish requests in flight, close the pool.
  const stop = async (signal: string) => {
    app.getHttpAdapter().getInstance().log.info({ signal }, 'Shutting down');
    await worker?.stop();
    await app.close();
    await deps.db.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}

void main();
