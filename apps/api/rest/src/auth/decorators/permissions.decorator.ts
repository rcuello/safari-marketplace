import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata que `PermissionsGuard` busca con `Reflector.
 * getAllAndOverride` (handler primero, clase después). design.md, Decisión B.
 */
export const PERMISSIONS_KEY = 'permissions';

/**
 * Exige que el token traiga AL MENOS UNO de los permisos indicados
 * (semántica any-of, igual que `hasAccess()` del admin). Sin `@Permissions()`
 * en una ruta protegida, un token válido basta.
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// Mismas combinaciones que `hasAccess()` ya compara en el admin
// (apps/admin/rest/src/utils/auth-utils.ts:13-18). No se inventan roles: son
// los 4 que ya existen en la base.
export const ADMIN_ONLY = ['super_admin'];
export const ADMIN_AND_OWNER = ['super_admin', 'store_owner'];
export const ADMIN_OWNER_AND_STAFF = ['super_admin', 'store_owner', 'staff'];
