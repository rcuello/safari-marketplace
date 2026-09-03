import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata que `JwtAuthGuard` busca con `Reflector.getAllAndOverride`
 * (handler primero, clase después). Se exporta junto al decorador para que no
 * exista un string suelto repetido en el guard (design.md, Decisión B).
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como pública: `JwtAuthGuard` la deja pasar sin mirar el
 * header `Authorization`. Va siempre a nivel de handler, salvo en los
 * controladores 100% públicos (p. ej. `NearByShopController`,
 * `WebHookController`): una clase marcada pública por error abre todos sus
 * verbos de golpe.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
