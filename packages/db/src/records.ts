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
  Attribute,
  AttributeValue,
  BecomeSeller,
  Category,
  Coupon,
  Faq,
  Manufacturer,
  Permission,
  Prisma,
  Profile,
  RefundPolicy,
  RefundReason,
  Setting,
  Shipping,
  Shop,
  ShopStaff,
  StoreNotice,
  Tag,
  Tax,
  TermsAndConditions,
  Type,
  User,
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

/**
 * Usuario, SIN `passwordHash` (frontera D-2 del Épico 19: el hash solo
 * cruza en `UserCredentials`, declarado en `users.repository.ts`, nunca
 * aquí).
 */
export interface UserRecord {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 1:1 con `users`, clavado por `userId` (la tabla no tiene `id` propio —
 * US-20 Decisión D-4).
 */
export interface ProfileRecord {
  userId: number;
  avatar: Prisma.JsonValue | null;
  bio: string | null;
  socials: Prisma.JsonValue | null;
  contact: string | null;
  notifications: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionRecord {
  id: number;
  name: string;
  guardName: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Pivote puro: la tabla no tiene `updated_at` (US-41 CA-1). */
export interface ShopStaffRecord {
  userId: number;
  shopId: number;
  createdAt: Date;
}

/**
 * Singleton de "vender con nosotros". `pageOptions` es el objeto INTERNO del
 * mock (24 claves) y `commissions` la lista de tiers: hermanas (US-41 CA-2).
 */
export interface BecomeSellerRecord {
  id: number;
  pageOptions: Prisma.JsonValue;
  commissions: Prisma.JsonValue;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * FAQ global (`shopId` null, emitida por el super admin) o de una tienda.
 * `issuedBy` es el nombre del emisor tal cual lo filtra el shop.
 */
export interface FaqRecord {
  id: number;
  faqTitle: string;
  slug: string;
  faqDescription: string;
  faqType: string;
  issuedBy: string;
  shopId: number | null;
  userId: number | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Misma forma que `FaqRecord` más la cola de moderación (`isApproved`). */
export interface TermsAndConditionsRecord {
  id: number;
  title: string;
  slug: string;
  description: string;
  type: string;
  issuedBy: string;
  isApproved: boolean;
  shopId: number | null;
  userId: number | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Política de reembolso: `target` vendor|customer, `status` approved|pending. */
export interface RefundPolicyRecord {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  target: string;
  status: string;
  shopId: number | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Clase de impuesto. `rate` es `numeric` sin escala → number (`_dec`): el
 * contrato emite `2`, no `2.00`.
 */
export interface TaxRecord {
  id: number;
  name: string;
  rate: number;
  isGlobal: boolean;
  country: string | null;
  state: string | null;
  zip: string | null;
  city: string | null;
  priority: number | null;
  onShipping: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Clase de envío. `type` ∈ fixed | percentage | free. */
export interface ShippingRecord {
  id: number;
  name: string;
  amount: number;
  isGlobal: boolean;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cupón (US-52). `amount`/`minimumCartAmount` son `numeric` sin escala →
 * number. `image` sale de una columna `json` (no `jsonb`): conserva el
 * orden de claves del mock. `is_valid` NO está aquí: depende del reloj y lo
 * calcula el consumidor.
 */
export interface CouponRecord {
  id: number;
  code: string;
  description: string | null;
  image: Prisma.JsonValue | null;
  type: string;
  amount: number;
  minimumCartAmount: number;
  activeFrom: Date;
  expireAt: Date;
  target: boolean;
  isApprove: boolean;
  shopId: number | null;
  userId: number | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Valor de un atributo (`Red`, `XL`…). El slug es único dentro del atributo. */
export interface AttributeValueRecord {
  id: number;
  attributeId: number;
  value: string;
  slug: string;
  meta: string | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Atributo de producto de una tienda, con sus valores en `id ASC`. */
export interface AttributeRecord {
  id: number;
  name: string;
  slug: string;
  shopId: number;
  language: string;
  createdAt: Date;
  updatedAt: Date;
  values: AttributeValueRecord[];
}

/** Aviso de tienda, sin relaciones. `type` decide a quién va dirigido. */
export interface StoreNoticeRecord {
  id: number;
  priority: string;
  notice: string;
  description: string | null;
  effectiveFrom: Date | null;
  expiredAt: Date;
  type: string;
  createdBy: number;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** El autor de un aviso con sus permisos (el contrato los embebe). */
export interface StoreNoticeCreatorRecord extends UserRecord {
  permissions: PermissionRecord[];
}

/** Estado de lectura de un usuario sobre un aviso. */
export interface StoreNoticeReadRecord {
  user: UserRecord;
  isRead: boolean;
}

/**
 * Un aviso con todo lo que la API emite: autor con permisos, usuarios y
 * tiendas destinatarios, y el estado de lectura de cada usuario. Los
 * destinatarios y las lecturas van por `userId DESC`, las tiendas por
 * `shopId ASC` y los permisos por `permissionId ASC`.
 */
export interface StoreNoticeDetailRecord extends StoreNoticeRecord {
  creator: StoreNoticeCreatorRecord;
  recipients: UserRecord[];
  shops: ShopRecord[];
  reads: StoreNoticeReadRecord[];
}

/** Motivo de reembolso. Sus timestamps son contrato: salen del mock. */
export interface RefundReasonRecord {
  id: number;
  name: string;
  slug: string;
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

/**
 * `row` tipado como `User` completo (incluye `passwordHash`) porque así
 * llega de cualquier `include`/`select` sin proyección — pero el mapper es
 * el choke point: nunca lo copia al `UserRecord` de salida (frontera D-2).
 */
export function _toUserRecord(row: User): UserRecord {
  return {
    id: _id(row.id),
    name: row.name,
    email: row.email,
    isActive: row.isActive,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toProfileRecord(row: Profile): ProfileRecord {
  return {
    userId: _id(row.userId),
    avatar: row.avatar,
    bio: row.bio,
    socials: row.socials,
    contact: row.contact,
    notifications: row.notifications,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toPermissionRecord(row: Permission): PermissionRecord {
  return {
    id: _id(row.id),
    name: row.name,
    guardName: row.guardName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toShopStaffRecord(row: ShopStaff): ShopStaffRecord {
  return {
    userId: _id(row.userId),
    shopId: _id(row.shopId),
    createdAt: row.createdAt,
  };
}

export function _toBecomeSellerRecord(row: BecomeSeller): BecomeSellerRecord {
  return {
    id: row.id, // smallint -> Int: sin _id(), como _toSettingRecord (:180)
    pageOptions: row.pageOptions,
    commissions: row.commissions,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toFaqRecord(row: Faq): FaqRecord {
  return {
    id: _id(row.id),
    faqTitle: row.faqTitle,
    slug: row.slug,
    faqDescription: row.faqDescription,
    faqType: row.faqType,
    issuedBy: row.issuedBy,
    shopId: _id(row.shopId),
    userId: _id(row.userId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toTermsAndConditionsRecord(
  row: TermsAndConditions
): TermsAndConditionsRecord {
  return {
    id: _id(row.id),
    title: row.title,
    slug: row.slug,
    description: row.description,
    type: row.type,
    issuedBy: row.issuedBy,
    isApproved: row.isApproved,
    shopId: _id(row.shopId),
    userId: _id(row.userId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toRefundPolicyRecord(row: RefundPolicy): RefundPolicyRecord {
  return {
    id: _id(row.id),
    title: row.title,
    slug: row.slug,
    description: row.description,
    target: row.target,
    status: row.status,
    shopId: _id(row.shopId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toRefundReasonRecord(row: RefundReason): RefundReasonRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toTaxRecord(row: Tax): TaxRecord {
  return {
    id: _id(row.id),
    name: row.name,
    rate: _dec(row.rate),
    isGlobal: row.isGlobal,
    country: row.country,
    state: row.state,
    zip: row.zip,
    city: row.city,
    priority: row.priority,
    onShipping: row.onShipping,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toShippingRecord(row: Shipping): ShippingRecord {
  return {
    id: _id(row.id),
    name: row.name,
    amount: _dec(row.amount),
    isGlobal: row.isGlobal,
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toAttributeValueRecord(row: AttributeValue): AttributeValueRecord {
  return {
    id: _id(row.id),
    attributeId: _id(row.attributeId),
    value: row.value,
    slug: row.slug,
    meta: row.meta,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `row.values` debe llegar ya ordenado (`id ASC`): el mapper no reordena. */
export function _toAttributeRecord(
  row: Attribute & { values: AttributeValue[] }
): AttributeRecord {
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    shopId: _id(row.shopId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    values: row.values.map(_toAttributeValueRecord),
  };
}

export function _toStoreNoticeRecord(row: StoreNotice): StoreNoticeRecord {
  return {
    id: _id(row.id),
    priority: row.priority,
    notice: row.notice,
    description: row.description,
    effectiveFrom: row.effectiveFrom,
    expiredAt: row.expiredAt,
    type: row.type,
    createdBy: _id(row.createdBy),
    updatedBy: _id(row.updatedBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function _toCouponRecord(row: Coupon): CouponRecord {
  return {
    id: _id(row.id),
    code: row.code,
    description: row.description,
    image: row.image,
    type: row.type,
    amount: _dec(row.amount),
    minimumCartAmount: _dec(row.minimumCartAmount),
    activeFrom: row.activeFrom,
    expireAt: row.expireAt,
    target: row.target,
    isApprove: row.isApprove,
    shopId: _id(row.shopId),
    userId: _id(row.userId),
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
