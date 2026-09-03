import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import {
  AuthenticatedRequest,
  INVALID_TOKEN_MESSAGE,
} from '../decorators/current-user.decorator';

export const INSUFFICIENT_PERMISSIONS_MESSAGE =
  'No tienes permisos suficientes para esta operación.';

/**
 * Resuelve los permisos EXCLUSIVAMENTE desde el payload del JWT (D-5 del épico,
 * CA-5): cero consultas a la base por request.
 *
 * COSTE ACEPTADO: revocar un permiso en Postgres NO afecta a un token ya emitido.
 * El usuario conserva ese permiso hasta que el JWT expira (`JWT_EXPIRES_IN`, 7 días
 * por defecto — jwt-options.ts:31). Revocación inmediata exigiría una denylist con
 * estado en el servidor, que D-9 de US-22 descartó explícitamente.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // sin @Permissions(), un token válido basta

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Regla anti-fuga (Decisión D, design.md): NUNCA deducir "no autorizado"
    // de la ausencia de usuario. Un 403 le confirmaría a un anónimo que la
    // ruta existe y es privilegiada; el 401 no dice nada que el default no
    // diga ya.
    if (!request.user) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    // Semántica any-of, idéntica a hasAccess() del admin
    // (apps/admin/rest/src/utils/auth-utils.ts:54-64).
    const hasPermission = required.some((permission) =>
      request.user.permissions.includes(permission),
    );
    if (!hasPermission) {
      throw new ForbiddenException(INSUFFICIENT_PERMISSIONS_MESSAGE);
    }

    return true;
  }
}
