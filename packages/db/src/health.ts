import { prisma } from './client';

export interface DatabasePing {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Liveness de Postgres: `SELECT 1` con timeout. Captura cualquier fallo y lo
 * devuelve como `{ ok: false }` — el caller decide el código HTTP. Pensado para
 * /health endpoints, que deben degradar a 503, no crashear.
 */
export async function pingDatabase(timeoutMs = 2000): Promise<DatabasePing> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
