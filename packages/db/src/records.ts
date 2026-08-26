/**
 * records.ts — la frontera de serialización de @safari/db.
 *
 * Los repositorios NUNCA devuelven filas crudas de Prisma: devuelven estos
 * records, que son JSON-safe por construcción. Dos conversiones deliberadas:
 *
 *   · BigInt → number. Los ids son bigserial y Prisma los trae como BigInt,
 *     que revienta JSON.stringify. Los ids reales caben de sobra en un
 *     number (el mock llega a ~1200).
 *   · Decimal → number. Los precios son numeric(12,2); el frontend de
 *     Pickbazar espera números JSON (`price: 40.5`), no strings. Con 12
 *     dígitos y 2 decimales, double-precision los representa sin pérdida
 *     práctica. La decisión completa está en el README del paquete.
 *
 * Las fechas quedan como Date: el consumidor (Nest/Next) las serializa a
 * ISO-8601 solo. Los mappers `_to*Record` son internos del paquete
 * (prefijo `_`); los tipos `*Record` son el contrato público.
 */

import type {
  Category,
  Manufacturer,
  Prisma,
  Setting,
  Shop,
  Tag,
  Type,
} from '../generated/prisma/client/client';

// ---------------------------------------------------------------------------
// Helpers de conversión
// ---------------------------------------------------------------------------

/** BigInt (bigserial) → number. Interno del paquete. */
export function _id(value: bigint): number;
export function _id(value: bigint | null): number | null;
export function _id(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

/** Prisma.Decimal → number. Interno del paquete. */
export function _dec(value: Prisma.Decimal): number;
export function _dec(value: Prisma.Decimal | null): number | null;
export function _dec(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

// ---------------------------------------------------------------------------
// Records públicos
// ---------------------------------------------------------------------------

export interface SettingRecord {
  id: number;
  options: Prisma.JsonValue;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TypeRecord {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  settings: Prisma.JsonValue;
  banners: Prisma.JsonValue;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopRecord {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  ownerId: number;
  isActive: boolean;
  logo: Prisma.JsonValue | null;
  coverImage: Prisma.JsonValue | null;
  address: Prisma.JsonValue;
  settings: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Conteo de productos `publish`/`visibility_public` del shop (Decisión E,
   * design.md). Opcional: `findOrCreateShopBySlug` (scraper) sigue
   * compilando sin calcularlo — el mapper del servicio usa `?? 0`.
   */
  productsCount?: number;
}

export interface CategoryRecord {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  details: string | null;
  image: Prisma.JsonValue | null;
  parentId: number | null;
  typeId: number;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManufacturerRecord {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  image: Prisma.JsonValue | null;
  typeId: number | null;
  isApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagRecord {
  id: number;
  name: string;
  slug: string;
  details: string | null;
  icon: string | null;
  image: Prisma.JsonValue | null;
  typeId: number | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Mappers (internos del paquete)
// ---------------------------------------------------------------------------

export function _toSettingRecord(row: Setting): SettingRecord {
  return {
    id: row.id,
    options: row.options,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toTypeRecord(row: Type): TypeRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    settings: row.settings,
    banners: row.banners,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toShopRecord(row: Shop): ShopRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerId: _id(row.ownerId),
    isActive: row.isActive,
    logo: row.logo,
    coverImage: row.coverImage,
    address: row.address,
    settings: row.settings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toCategoryRecord(row: Category): CategoryRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    details: row.details,
    image: row.image,
    parentId: _id(row.parentId),
    typeId: _id(row.typeId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toManufacturerRecord(row: Manufacturer): ManufacturerRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    website: row.website,
    image: row.image,
    typeId: _id(row.typeId),
    isApproved: row.isApproved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toTagRecord(row: Tag): TagRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    details: row.details,
    icon: row.icon,
    image: row.image,
    typeId: _id(row.typeId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
