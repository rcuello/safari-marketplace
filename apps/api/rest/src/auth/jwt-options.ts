import { JwtModuleOptions } from '@nestjs/jwt';

/**
 * Único lector de `JWT_SECRET`/`JWT_EXPIRES_IN` (Decisión B, design.md).
 *
 * `apps/api/rest` no carga `.env` con `dotenv` propio: lo hace
 * `ConfigModule.forRoot()` (`app.module.ts`), de forma síncrona, pero
 * DESPUÉS de que se evalúen los `require` de los módulos hijos —
 * `AuthModule` incluido. Por eso ningún `process.env.JWT_SECRET` leído al
 * importar `auth.module.ts` o `current-user.decorator.ts` puede confiar en
 * ver el valor real: hay que diferir la lectura al momento en que Nest
 * instancia el provider (`JwtModule.registerAsync`) o al primer request
 * (`@CurrentUser()`). Esta función es ese único punto, memoizado para que
 * ambos consumidores usen exactamente el mismo secreto.
 */
let cached: JwtModuleOptions | undefined;

export function resolveJwtOptions(): JwtModuleOptions {
  if (cached) return cached;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET no está definido (o está vacío) en el entorno. ' +
        'Agrégalo a apps/api/rest/.env — ver apps/README.md.',
    );
  }

  cached = {
    secret,
    signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  };
  return cached;
}
