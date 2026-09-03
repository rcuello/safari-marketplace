import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AuthenticatedRequest,
  CurrentUserPayload,
  INVALID_TOKEN_MESSAGE,
} from '../decorators/current-user.decorator';

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return undefined;
  return token;
}

/**
 * Guard global (registrado como provider de guard global de Nest en la
 * Fase 3 de `tasks.md` — inerte hasta entonces), deny-by-default. Ruta sin
 * `@Public()` exige un
 * bearer token válido: ausencia de header, esquema distinto de `Bearer`,
 * token vacío, firma inválida o expirado devuelven 401 con el mismo
 * `INVALID_TOKEN_MESSAGE` que ya emitía `@CurrentUser()` en US-22 (design.md,
 * Decisión D). Ruta con `@Public()` pasa sin mirar el header — una cookie
 * vencida no debe romper el checkout de invitado.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    try {
      request.user = this.jwtService.verify<CurrentUserPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
  }
}
