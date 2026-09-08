/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Gate portante de PR2 (US-25, extracción del mapper): prueba que
 * `toUserDto`/`toProfileDto`/`toPermissionDto`, movidas verbatim desde
 * `auth.service.ts`, siguen emitiendo exactamente el mismo shape.
 *
 * `toUserDto` solo importa TIPOS de `@safari/db` (`import type`, erasable
 * en compilación) y `toShopDto` de `shops.service.ts` (función pura, sin
 * DI) — no hay nada que mockear ni base de datos que levantar.
 */
import 'reflect-metadata';
import type { UserWithRelations } from '@safari/db';
import { toPermissionDto, toProfileDto, toUserDto } from './user-dto.mapper';

const FIXED_DATE = new Date('2026-09-02T15:33:36.102Z');

function buildFixture(): UserWithRelations {
  return {
    id: 3,
    name: 'Jhon Doe',
    email: 'admin@demo.com',
    emailVerifiedAt: new Date('2023-11-12T10:59:14.000Z'),
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    isActive: true,
    profile: {
      userId: 3,
      avatar: { id: 1691, original: 'orig.png', thumbnail: 'thumb.jpg' },
      bio: null,
      socials: null,
      contact: '19365141641631',
      notifications: null,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
    permissions: [
      { id: 1, name: 'super_admin', guardName: 'api', createdAt: FIXED_DATE, updatedAt: FIXED_DATE },
    ],
    shops: [],
  };
}

describe('user-dto.mapper (US-25 PR2 — extracción pura, cero cambio observable)', () => {
  describe('toUserDto', () => {
    it('emite las 15 claves en el orden exacto que publicaba /me', () => {
      const dto = toUserDto(buildFixture());

      expect(Object.keys(dto)).toEqual([
        'id',
        'name',
        'email',
        'email_verified_at',
        'created_at',
        'updated_at',
        'is_active',
        'shop_id',
        'email_verified',
        'profile',
        'permissions',
        'wallet',
        'shops',
        'last_order',
        'address',
      ]);
    });

    it('wallet y last_order son null, address es []', () => {
      const dto = toUserDto(buildFixture()) as unknown as Record<string, unknown>;

      expect(dto.wallet).toBeNull();
      expect(dto.last_order).toBeNull();
      expect(dto.address).toEqual([]);
    });

    it('profile null si el usuario no tiene perfil', () => {
      const fixture = { ...buildFixture(), profile: null };
      const dto = toUserDto(fixture) as unknown as Record<string, unknown>;

      expect(dto.profile).toBeNull();
    });
  });

  describe('toProfileDto', () => {
    it('sintetiza id y customer_id = userId (la tabla no tiene id propio)', () => {
      const dto = toProfileDto({
        userId: 7,
        avatar: null,
        bio: 'hola',
        socials: null,
        contact: null,
        notifications: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });

      expect(dto.id).toBe(7);
      expect(dto.customer_id).toBe(7);
    });
  });

  describe('toPermissionDto', () => {
    it('sintetiza pivot con model_id = userId real', () => {
      const dto = toPermissionDto(
        { id: 2, name: 'customer', guardName: 'api', createdAt: FIXED_DATE, updatedAt: FIXED_DATE },
        42,
      );

      expect(dto.pivot).toEqual({
        model_id: 42,
        permission_id: 2,
        model_type: 'Marvel\\Database\\Models\\User',
      });
    });
  });
});
