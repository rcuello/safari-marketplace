import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { resolveJwtOptions } from './jwt-options';

export const INVALID_TOKEN_MESSAGE = 'Token de autenticación ausente o inválido.';

export interface CurrentUserPayload {
  sub: number;
  email: string;
  permissions: string[];
  iat: number;
  exp: number;
}

/**
 * `JwtService` de ámbito de módulo, construido de forma DIFERIDA (en el
 * primer request, no al importar este archivo) y memoizado. No puede
 * inyectarse: la factory de `createParamDecorator` la invoca
 * `RouteParamsFactory` con `(data, ctx)`, fuera del contenedor de DI
 * (Decisión C, design.md). Diferir la construcción evita leer
 * `JWT_SECRET` antes de que `.env` esté cargado.
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
 * Extrae y verifica el bearer token del header `Authorization`, y devuelve
 * el payload (`sub`, `email`, `permissions`, `iat`, `exp`). NO consulta la
 * base: cargar el usuario aquí duplicaría la consulta de `/me` y añadiría
 * una inútil en `change-password`, que solo necesita el email.
 *
 * Es un decorador de parámetro puro, sin clase de autorización asociada
 * (D-1 del proposal, Decisión C del diseño): la protección de rutas es
 * US-23, no este cambio.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request>();
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
