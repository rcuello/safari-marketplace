import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { resolveJwtOptions } from '../jwt-options';

export const INVALID_TOKEN_MESSAGE = 'Token de autenticación ausente o inválido.';

export interface CurrentUserPayload {
  sub: number;
  email: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export type AuthenticatedRequest = Request & { user?: CurrentUserPayload };

/**
 * `JwtService` de ámbito de módulo, construido de forma DIFERIDA (en el
 * primer request, no al importar este archivo) y memoizado. No puede
 * inyectarse: la factory de `createParamDecorator` la invoca
 * `RouteParamsFactory` con `(data, ctx)`, fuera del contenedor de DI
 * (Decisión C, design.md). Diferir la construcción evita leer
 * `JWT_SECRET` antes de que `.env` esté cargado.
 *
 * Solo se usa en el fallback de abajo: el camino normal ya no verifica nada
 * aquí, lee `request.user`, poblado por `JwtAuthGuard`.
 */
let jwtService: JwtService | undefined;

function getJwtService(): JwtService {
  if (!jwtService) {
    jwtService = new JwtService(resolveJwtOptions());
  }
  return jwtService;
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return undefined;
  return token;
}

/**
 * Devuelve el payload del usuario autenticado (`sub`, `email`,
 * `permissions`, `iat`, `exp`). Contrato con el guard (US-23): el camino
 * normal es `request.user`, poblado por `JwtAuthGuard`, sin volver a
 * verificar el token.
 *
 * Fallback deliberado (D-3, design.md): si `request.user` no está —los
 * guards globales no están registrados, p. ej. tras un rollback de
 * emergencia— este decorador verifica el bearer por su cuenta, igual que en
 * US-22. Es lo que hace que quitar los dos guards globales de
 * `app.module.ts` sea un rollback de una línea sin romper `/me`,
 * `change-password` ni `add-points`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user) return request.user;

    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    try {
      return getJwtService().verify<CurrentUserPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
  },
);
