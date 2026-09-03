import { Logger } from '@nestjs/common';

/**
 * Único lector de `PASSWORD_RESET_TTL_MINUTES`/`OTP_CODE_TTL_MINUTES`
 * (Decisión F, design.md). Mismo motivo de lectura diferida y memoizada que
 * `jwt-options.ts`: `ConfigModule.forRoot()` puebla `process.env` DESPUÉS de
 * evaluar los `require` de los módulos hijos, así que un `process.env.X`
 * leído al importar `auth.service.ts` sería `undefined`. El primer
 * `resolveRecoveryOptions()` ocurre dentro de un request, mucho después.
 *
 * A diferencia de `resolveJwtOptions()`, un TTL malformado NUNCA lanza: la
 * lectura es diferida, así que un `throw` fallaría en el primer
 * `forget-password`/`send-otp-code` (endpoints públicos, sin cobertura de
 * `withPrismaErrorTranslation`) en vez de en el arranque — un fail-fast que
 * no es fast es peor que un default seguro.
 */
let cached: RecoveryOptions | undefined;

export interface RecoveryOptions {
  passwordResetTtlMinutes: number;
  otpCodeTtlMinutes: number;
}

export function resolveRecoveryOptions(): RecoveryOptions {
  if (cached) return cached;

  cached = {
    passwordResetTtlMinutes: readTtlMinutes('PASSWORD_RESET_TTL_MINUTES', 60),
    otpCodeTtlMinutes: readTtlMinutes('OTP_CODE_TTL_MINUTES', 10),
  };
  return cached;
}

function readTtlMinutes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw); // Number('10min') = NaN; Number('') = 0
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    new Logger('recovery-options').warn(
      `${name}="${raw}" no es un entero de minutos válido; se usa ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}
