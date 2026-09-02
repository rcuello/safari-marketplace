/**
 * users.repository.ts — identidad (Épico 19, US-21). Sirve login (US-22),
 * `/me` (US-22) y las listas de administración (US-25) desde la misma
 * forma que ya usan products/shops/settings: funciones planas + records
 * JSON-safe.
 *
 * Frontera D-2 del épico: `passwordHash` es entrada de dos escrituras
 * (`createUser`, `updateUserPasswordHash`) y salida de UNA sola lectura
 * (`findUserCredentialsByEmail`). `UserCredentials` vive aquí, NO en
 * `records.ts`, para que la frontera de serialización del paquete ni
 * siquiera nombre el campo.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import {
  _id,
  _toPermissionRecord,
  _toProfileRecord,
  _toShopRecord,
  _toUserRecord,
  type PermissionRecord,
  type ProfileRecord,
  type ShopRecord,
  type UserRecord,
} from '../records';

// ---------------------------------------------------------------------------
// Tipos — NO en records.ts (ver cabecera del archivo)
// ---------------------------------------------------------------------------

/** La ÚNICA forma que lleva el hash de contraseña fuera de la base. */
export interface UserCredentials {
  id: number;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

export interface UserWithRelations extends UserRecord {
  profile: ProfileRecord | null;
  permissions: PermissionRecord[];
  shops: ShopRecord[];
}

export interface ListUsersInput {
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
  /** Búsqueda parcial por nombre o email, case-insensitive. */
  text?: string;
  /** Filtra por el nombre del permiso asignado (p. ej. 'super_admin'). */
  permissionName?: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  /** Ya hasheado — hashear es responsabilidad de la API (US-22). */
  passwordHash: string;
  isActive?: boolean;
  emailVerifiedAt?: Date | null;
  profile?: {
    avatar?: Prisma.InputJsonValue;
    bio?: string;
    socials?: Prisma.InputJsonValue;
    contact?: string;
    notifications?: Prisma.InputJsonValue;
  };
  /** `connect: { name }` — `permissions.name` es UNIQUE. */
  permissionNames?: string[];
}

export class DuplicateEmailError extends Error {
  readonly code = 'USER_DUPLICATE_EMAIL';
  constructor(email: string) {
    super(`Ya existe un usuario con el email ${email}.`);
    this.name = 'DuplicateEmailError';
  }
}

// ---------------------------------------------------------------------------
// Lectura de credenciales — el único SQL crudo de dominio (D-1)
// ---------------------------------------------------------------------------

/** Fila cruda del `$queryRaw`, snake_case, NO exportada. */
interface UserCredentialsRow {
  id: bigint;
  email: string;
  password_hash: string;
  is_active: boolean;
}

/**
 * La ÚNICA función que devuelve `passwordHash`. `$queryRaw` con
 * `lower(email) = lower($1)` explícito: es la única forma, de las
 * evaluadas contra Postgres real, que usa `users_email_lower_idx` (ni
 * `mode: 'insensitive'` de Prisma —`ILIKE`— ni normalizar en JS antes de
 * un `equals` plano lo usan; precedente de `$queryRaw`: `health.ts:21`).
 * `${email}` es parámetro del tagged template -> $1, NO concatenación:
 * prohibido `$queryRawUnsafe`.
 */
export async function findUserCredentialsByEmail(
  email: string
): Promise<UserCredentials | null> {
  const rows = await prisma.$queryRaw<UserCredentialsRow[]>`
    SELECT id, email, password_hash, is_active
      FROM users
     WHERE lower(email) = lower(${email})
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: _id(row.id),
    email: row.email,
    passwordHash: row.password_hash,
    isActive: row.is_active,
  };
}

// ---------------------------------------------------------------------------
// Lectura del usuario — escalares y con relaciones
// ---------------------------------------------------------------------------

/** Usuario por id, sin relaciones. `null` si no existe. */
export async function findUserById(id: number): Promise<UserRecord | null> {
  const row = await prisma.user.findUnique({ where: { id } });
  if (!row) return null;
  return _toUserRecord(row);
}

/**
 * `include` compartido: perfil, permisos (vía el pivote explícito) y
 * tiendas de las que el usuario es dueño — el shape que `/me` (US-22) y
 * el detalle de usuario (US-25) publican.
 */
const USER_RELATIONS = {
  profile: true,
  permissions: { include: { permission: true } },
  shops: true,
} satisfies Prisma.UserInclude;

type UserWithRelationsPayload = Prisma.UserGetPayload<{
  include: typeof USER_RELATIONS;
}>;

/** Usuario por id con perfil, permisos y tiendas. `null` si no existe. */
export async function findUserWithRelations(
  id: number
): Promise<UserWithRelations | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    include: USER_RELATIONS,
  });
  if (!row) return null;
  return _toUserWithRelations(row);
}

function _toUserWithRelations(
  row: UserWithRelationsPayload
): UserWithRelations {
  return {
    ..._toUserRecord(row),
    profile: row.profile ? _toProfileRecord(row.profile) : null,
    permissions: row.permissions.map((link) =>
      _toPermissionRecord(link.permission)
    ),
    shops: row.shops.map(_toShopRecord),
  };
}

// ---------------------------------------------------------------------------
// Listado paginado (D-2 del proposal: `{ items, total }`, no el wrapper)
// ---------------------------------------------------------------------------

/**
 * Listado paginado. `{ items, total }`; el caller (servicio de Nest de
 * US-25) arma el envoltorio con `buildPaginator`. Filtra por nombre de
 * permiso (`permissionName`, vía el índice inverso del pivote) y busca
 * por nombre o email (`text`, `contains`/`insensitive` — NO usa
 * `users_email_lower_idx`, que sirve a la igualdad exacta de D-1).
 */
export async function listUsers(input: ListUsersInput = {}): Promise<{
  items: UserRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.UserWhereInput = {
    ...(input.permissionName && {
      permissions: { some: { permission: { name: input.permissionName } } },
    }),
    ...(input.text && {
      OR: [
        { name: { contains: input.text, mode: 'insensitive' as const } },
        { email: { contains: input.text, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { items: rows.map(_toUserRecord), total };
}

// ---------------------------------------------------------------------------
// Escrituras (CA-4) — exactamente tres; `grantPermission` es de US-25
// ---------------------------------------------------------------------------

/**
 * Crea usuario, perfil (si viene) y sus permisos iniciales (por nombre,
 * `connect`). Nested write: Prisma lo envuelve en una transacción por
 * construcción — el paquete mantiene sus 0 usos de `$transaction`.
 * Traduce P2002 (email duplicado, el índice único de expresión que
 * Prisma no modela) a `DuplicateEmailError`; el email se persiste
 * verbatim, sin `toLowerCase()` (Decisión H, design.md).
 */
export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  try {
    const row = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        isActive: input.isActive ?? true,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        ...(input.profile && {
          profile: { create: { ...input.profile } },
        }),
        ...(input.permissionNames && {
          permissions: {
            create: input.permissionNames.map((name) => ({
              permission: { connect: { name } },
            })),
          },
        }),
      },
    });
    return _toUserRecord(row);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new DuplicateEmailError(input.email);
    }
    throw error;
  }
}

/**
 * Cambia el hash de contraseña (US-22 login/registro, US-24 reset).
 * `null` si el id no existe (traduce P2025).
 */
export async function updateUserPasswordHash(
  id: number,
  passwordHash: string
): Promise<UserRecord | null> {
  try {
    const row = await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    return _toUserRecord(row);
  } catch (error) {
    if (_isRecordNotFound(error)) return null;
    throw error;
  }
}

/** Activa/desactiva (`isActive`). `null` si el id no existe. */
export async function setUserActive(
  id: number,
  isActive: boolean
): Promise<UserRecord | null> {
  try {
    const row = await prisma.user.update({
      where: { id },
      data: { isActive },
    });
    return _toUserRecord(row);
  } catch (error) {
    if (_isRecordNotFound(error)) return null;
    throw error;
  }
}

function _isRecordNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2025'
  );
}
