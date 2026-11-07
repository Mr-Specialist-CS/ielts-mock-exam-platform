import { handleApiRequest, runRetentionCleanup, syncFileInventory } from './server/apiHandler';
import { D1Storage, MemoryStorage, IStorage } from './server/storage';

let globalStorage: IStorage | null = null;

function getStorage(env: Record<string, any>): IStorage {
  if (!globalStorage) {
    if (env.DB) {
      globalStorage = new D1Storage(env.DB, env);
    } else {
      globalStorage = new MemoryStorage();
    }
  }
  return globalStorage;
}

export default {
  async fetch(request: Request, env: Record<string, any>): Promise<Response> {
    const url = new URL(request.url);

    // Strict production check: do not silently switch to memory
    if (!env.DB) {
      const isExplicitLocalDev = env.ALLOW_MEMORY_STORAGE === 'true' || env.ALLOW_MEMORY_STORAGE === true;
      if (!isExplicitLocalDev) {
        console.error('[CRITICAL] Cloudflare D1 database binding "DB" is not configured.');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Cloudflare D1 Database Not Configured',
            message:
              'CRITICAL DATABASE CONFIGURATION ERROR: Cloudflare D1 database binding "DB" is not bound to this deployment. Production cannot silently switch to ephemeral in-memory storage because candidate sessions, exam answers, and grading records would be lost across serverless edge isolates. Please attach your Cloudflare D1 database to the "DB" binding in Cloudflare Dashboard or wrangler.json.',
            requiredBinding: 'DB',
            status: 503
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': request.headers.get('Origin') || '*'
            }
          }
        );
      }
    }

    const storage = getStorage(env);

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, storage, env);
    }

    // Serve frontend static assets (Vite React SPA) via Workers Static Assets
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('IELTS Gate Cloudflare Worker Active', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  // Daily cron: inventory the file bucket, then purge user records older
  // than the retention window (180 days). Fully automatic — no admin action.
  async scheduled(event: any, env: Record<string, any>, ctx: any): Promise<void> {
    const storage = getStorage(env);
    const run = (async () => {
      try {
        const inv = await syncFileInventory(storage, env);
        const result = await runRetentionCleanup(storage, env);
        console.log(
          `[Retention] inventoried=${inv.tracked} purged sessions=${result.deletedSessionIds.length} ` +
          `registrations=${result.deletedRegistrationIds.length} files=${result.deletedFiles.length}`
        );
      } catch (e) {
        console.error('[Retention] cleanup failed:', e);
      }
    })();
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(run);
    } else {
      await run;
    }
  }
};
