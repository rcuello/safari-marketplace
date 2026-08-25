/**
 * Prisma Error Utilities
 *
 * Utilidades para detectar, clasificar y formatear errores de Prisma de forma
 * amigable y útil para debugging. Centralizado en @safari/db.
 *
 * Uso:
 *   import { isPrismaError, formatPrismaError } from '@safari/db';
 *
 *   try {
 *     await prisma.user.findFirst();
 *   } catch (error) {
 *     if (isPrismaConnectionError(error)) {
 *       logger.error('BD no disponible', error);
 *     }
 *   }
 */

// ============================================================================
// Types
// ============================================================================

export interface PrismaErrorInfo {
  type: 'connection' | 'timeout' | 'constraint' | 'not_found' | 'unknown';
  message: string;
  details?: {
    code?: string;
    meta?: Record<string, unknown>;
    clientVersion?: string;
  };
}

// ============================================================================
// Error Detection
// ============================================================================

/**
 * Detecta si un error es de Prisma
 */
export function isPrismaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const errorName = (error as Error).name;
  return (
    errorName?.startsWith('Prisma') ||
    'code' in error ||
    'clientVersion' in error
  );
}

/**
 * Detecta si es un error de conexión a la BD
 */
export function isPrismaConnectionError(error: unknown): boolean {
  if (!isPrismaError(error)) return false;

  const errorName = (error as Error).name;
  const message = (error as Error).message.toLowerCase();

  return (
    errorName === 'PrismaClientInitializationError' ||
    errorName === 'PrismaClientKnownRequestError' ||
    message.includes("can't reach database server") ||
    message.includes('connection refused') ||
    message.includes('connection timeout') ||
    message.includes('econnrefused')
  );
}

/**
 * Detecta si es un error de timeout
 */
export function isPrismaTimeoutError(error: unknown): boolean {
  if (!isPrismaError(error)) return false;

  const message = (error as Error).message.toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

/**
 * Detecta si es un error de constraint (unique, foreign key, etc.)
 */
export function isPrismaConstraintError(error: unknown): boolean {
  if (!isPrismaError(error)) return false;

  const err = error as { code?: string };
  return err.code === 'P2002' || err.code === 'P2003' || err.code === 'P2025';
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Mensaje amigable para un error de constraint de Prisma (P2002/P2003/P2025).
 */
function resolveConstraintMessage(
  code: string | undefined,
  meta: Record<string, unknown> | undefined
): string {
  if (code === 'P2002') {
    const target = meta?.target as string[] | undefined;
    return `Ya existe un registro con ${target ? target.join(', ') : 'estos valores'}`;
  }
  if (code === 'P2003') {
    return 'Error de relación: el registro referenciado no existe';
  }
  if (code === 'P2025') {
    return 'Registro no encontrado';
  }
  return 'Error de integridad en la base de datos';
}

/**
 * Extrae información útil de un error de Prisma
 */
export function parsePrismaError(error: unknown): PrismaErrorInfo {
  if (!isPrismaError(error)) {
    return {
      type: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const err = error as Error & {
    code?: string;
    meta?: Record<string, unknown>;
    clientVersion?: string;
  };

  // Error de conexión
  if (isPrismaConnectionError(error)) {
    // Extraer host y puerto del mensaje de error
    const hostMatch = err.message.match(/at `([^`]+)`/);
    const host = hostMatch ? hostMatch[1] : 'localhost:5432';

    return {
      type: 'connection',
      message: `No se puede conectar a la base de datos en ${host}`,
      details: {
        code: err.code,
        clientVersion: err.clientVersion,
      },
    };
  }

  // Error de timeout
  if (isPrismaTimeoutError(error)) {
    return {
      type: 'timeout',
      message: 'La consulta a la base de datos tardó demasiado',
      details: {
        code: err.code,
        meta: err.meta,
      },
    };
  }

  // Error de constraint
  if (isPrismaConstraintError(error)) {
    return {
      type: 'constraint',
      message: resolveConstraintMessage(err.code, err.meta),
      details: {
        code: err.code,
        meta: err.meta,
      },
    };
  }

  // Error desconocido de Prisma
  return {
    type: 'unknown',
    message: err.message,
    details: {
      code: err.code,
      meta: err.meta,
      clientVersion: err.clientVersion,
    },
  };
}

/**
 * Formatea un error de Prisma de forma amigable para logs
 *
 * @param error - Error de Prisma
 * @param includeStack - Si incluir stack trace (solo en desarrollo)
 * @returns Objeto formateado para el logger
 */
export function formatPrismaError(
  error: unknown,
  includeStack = false
): {
  name: string;
  message: string;
  stack?: string;
  prisma?: PrismaErrorInfo;
} {
  if (!isPrismaError(error)) {
    return {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: includeStack && error instanceof Error ? error.stack : undefined,
    };
  }

  const info = parsePrismaError(error);
  const err = error as Error;

  return {
    name: err.name,
    message: info.message,
    stack: includeStack ? err.stack : undefined,
    prisma: {
      type: info.type,
      message: info.message,
      details: info.details,
    },
  };
}

// ============================================================================
// User-Friendly Messages
// ============================================================================

/**
 * Retorna mensaje amigable para el usuario final (para mostrar en UI)
 */
export function getUserFriendlyMessage(error: unknown): string {
  const info = parsePrismaError(error);

  switch (info.type) {
    case 'connection':
      return 'No se puede conectar con el servicio. Por favor, intenta más tarde.';
    case 'timeout':
      return 'La operación tardó demasiado. Por favor, intenta nuevamente.';
    case 'constraint':
      return info.message;
    default:
      return 'Ocurrió un error inesperado. Por favor, contacta al administrador.';
  }
}
