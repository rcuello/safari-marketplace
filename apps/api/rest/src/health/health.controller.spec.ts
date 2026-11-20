/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios del health de la API (US-17). Se mockea solo `pingDatabase`
 * de `@safari/db`; el controller y el service son reales.
 */
import 'reflect-metadata';
import { hostname } from 'node:os';
import { ServiceUnavailableException } from '@nestjs/common';
import { pingDatabase } from '@safari/db';
import { IS_PUBLIC_KEY } from '#src/auth/decorators/public.decorator.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  pingDatabase: vi.fn(),
}));

const pingDatabaseMock = vi.mocked(pingDatabase);

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new HealthController(new HealthService());
  });

  it('es público: lo pueden llamar los healthchecks sin token', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBe(true);
  });

  it('liveness responde ok y la réplica, sin tocar la base', () => {
    expect(controller.liveness()).toEqual({
      status: 'ok',
      instance: hostname(),
    });
    expect(pingDatabaseMock).not.toHaveBeenCalled();
  });

  it('readiness con la base arriba devuelve ok y la latencia', async () => {
    pingDatabaseMock.mockResolvedValue({ ok: true, latencyMs: 3 });
    await expect(controller.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: { status: 'up', latency_ms: 3 } },
    });
  });

  it('readiness con la base caída lanza 503 nombrando la base, sin el error del driver', async () => {
    pingDatabaseMock.mockResolvedValue({
      ok: false,
      latencyMs: 2001,
      error: 'connect ECONNREFUSED 127.0.0.1:5433',
    });
    const error = await controller.readiness().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(body).toEqual({
      status: 'error',
      checks: { database: { status: 'down', latency_ms: 2001 } },
    });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
