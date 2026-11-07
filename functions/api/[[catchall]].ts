import { handleApiRequest } from '../../src/server/apiHandler';
import { D1Storage, MemoryStorage, IStorage } from '../../src/server/storage';

// In-memory cache for the Worker isolate
let globalStorage: IStorage | null = null;

export async function onRequest(context: {
  request: Request;
  env: Record<string, any>;
  params: Record<string, any>;
}): Promise<Response> {
  const { request, env } = context;

  // Strict check: DO NOT silently switch to memory in production
  if (!env.DB) {
    const isExplicitLocalDev = env.ALLOW_MEMORY_STORAGE === 'true' || env.ALLOW_MEMORY_STORAGE === true;
    if (!isExplicitLocalDev) {
      console.error('[CRITICAL] Cloudflare D1 database binding "DB" is not configured.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cloudflare D1 Database Not Configured',
          message:
            'CRITICAL DATABASE CONFIGURATION ERROR: Cloudflare D1 database binding "DB" is not bound to this deployment. Production cannot silently switch to ephemeral in-memory storage because candidate sessions, exam answers, and grading records would be lost across serverless edge isolates. Please attach your Cloudflare D1 database to the "DB" binding in Cloudflare Dashboard (Pages > Settings > Functions > D1 database bindings) or wrangler.json.',
          requiredBinding: 'DB',
          status: 503
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }

  if (!globalStorage) {
    if (env.DB) {
      globalStorage = new D1Storage(env.DB, env);
    } else {
      globalStorage = new MemoryStorage();
    }
  }

  try {
    return await handleApiRequest(request, globalStorage, env);
  } catch (err: any) {
    console.error('[Cloudflare Edge Database Error]:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Cloudflare Edge Database Error',
        message: err?.message || 'Database operation failed on Cloudflare D1.',
        status: 500
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}
