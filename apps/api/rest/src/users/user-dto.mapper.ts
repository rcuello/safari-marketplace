import type {
  PermissionRecord,
  ProfileRecord,
  UserWithRelations,
} from '@safari/db';
import { User } from './entities/user.entity';
import { toShopDto } from 'src/shops/shops.service';

/**
 * `ProfileRecord` (camelCase) → shape Laravel. `id` y `customer_id` no
 * existen en la tabla (la PK real es `user_id`, US-20 Decisión D-4): se
 * sintetizan ambas = `userId` (V-5 del design). Clave preservada porque
 * `shop/src/pages/profile.tsx:26` lee `me.profile?.id!`.
 *
 * Movida verbatim desde `auth.service.ts` (US-25/PR2, D-A del design):
 * `auth` y `users` no se poseen entre sí, así que el mapper vive en un
 * tercer módulo neutro. Anotación de retorno explícita (`Record<string,
 * unknown>`, no en el design): al exportar la función desde un archivo
 * nuevo, `tsc --declaration` (activo en `tsconfig.json`) exige un tipo
 * nombrable — el inferido referencia `runtime.JsonValue` de
 * `@prisma/client`, no portable fuera de `@safari/db`. Solo de compilación;
 * no cambia el objeto que se devuelve en runtime.
 */
export function toProfileDto(p: ProfileRecord): Record<string, unknown> {
  return {
    id: p.userId,
    avatar: p.avatar,
    bio: p.bio,
    socials: p.socials,
    contact: p.contact,
    notifications: p.notifications,
    customer_id: p.userId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/**
 * `PermissionRecord` → shape Laravel con `pivot` sintetizado (V-3 del
 * design: `PermissionRecord` no modela `pivot`, no hay tabla intermedia
 * que serializar). `model_id` pasa de `6` fijo (Laravel) al id real del
 * usuario.
 */
export function toPermissionDto(
  p: PermissionRecord,
  userId: number,
): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    guard_name: p.guardName,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    pivot: {
      model_id: userId,
      permission_id: p.id,
      model_type: 'Marvel\\Database\\Models\\User',
    },
  };
}

/**
 * `UserWithRelations` → las 15 claves de `/me` (Decisión E, design.md), en
 * el mismo orden que publicaba `users.json`. `wallet`, `last_order` y
 * `address` son constantes (D-13/V-7): el mock traía un pedido completo y
 * dos direcciones para el usuario 3, pero no hay tablas que los respalden
 * todavía. `managed_shop` no se emite (V-11: el mock tampoco lo emitía).
 *
 * Ex `toMeDto` (`auth.service.ts:123-141`), renombrada porque en US-25 la
 * usan tanto `/me` como `GET /api/users/:id` (D-A del design).
 */
export function toUserDto(record: UserWithRelations): User {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    email_verified_at: record.emailVerifiedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    is_active: Number(record.isActive),
    shop_id: null,
    email_verified: record.emailVerifiedAt !== null,
    profile: record.profile ? toProfileDto(record.profile) : null,
    permissions: record.permissions.map((p) => toPermissionDto(p, record.id)),
    wallet: null,
    shops: record.shops.map(toShopDto),
    last_order: null,
    address: [],
  } as unknown as User;
}
