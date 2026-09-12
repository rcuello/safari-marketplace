/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 9 shops del mock + 3 reconstruidas
 * desde productos scrapeados = 12). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  createShop,
  findShopBySlug,
  listShops,
  listShopsNear,
  setShopActive,
  updateShop,
} from './shops.repository';

// ---------------------------------------------------------------------------
// US-30: centinela por prefijo de slug (DD30-6, `zz-tiendas-`, NO
// `zz-shops-`: ese prefijo rompería `toBe(7)` de abajo si la centinela
// quedara activa, porque el filtro de `listShops({name:...})` es sobre
// `name`, y el nombre es lo que deriva el slug). `ownerId: 3` en todos los
// centinelas de este archivo: `admin@demo.com` no posee ninguna tienda hoy,
// así que una fila superviviente degrada como mucho un archivo
// (`shops.integration.test.ts`), nunca `users.integration.test.ts:88,147`
// (`shops: true` sin `where`).
// ---------------------------------------------------------------------------
const SENTINEL_PREFIX = 'zz-tiendas-';
const cleanupSentinel = () =>
  prisma.shop.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanupSentinel);

afterAll(async () => {
  await cleanupSentinel();
  await prisma.$disconnect();
});

describe('listShops', () => {
  it('lista las 12 tiendas, id desc (D), JSON-safe', async () => {
    const { items, total } = await listShops();
    expect(total).toBe(12);
    expect(items[0].id).toBe(15);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('incluye las 3 filas reconstruidas (CA-3)', async () => {
    const { items } = await listShops();
    const slugs = items.map((r) => r.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['noaw', 'launchidea', 'tetetetet'])
    );
  });

  it('productsCount filtrado por publish/visibility_public (Decisión E)', async () => {
    const { items } = await listShops();
    const bySlug = Object.fromEntries(items.map((r) => [r.slug, r]));
    expect(bySlug['grocery-shop'].productsCount).toBe(584);
    expect(bySlug['makeup-shop'].productsCount).toBe(82);
    expect(bySlug.noaw.productsCount).toBe(188);
  });

  it('filtra por name case-insensitive "shop" → 7', async () => {
    expect((await listShops({ name: 'shop' })).total).toBe(7);
  });
});

describe('findShopBySlug', () => {
  it('trae el mismo productsCount filtrado que el listado (Decisión E)', async () => {
    const row = await findShopBySlug('gadget');
    expect(row?.productsCount).toBe(44);
  });

  it('devuelve null cuando el slug no existe', async () => {
    expect(await findShopBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// US-5: listShopsNear — haversine real sobre las 6 tiendas con coordenadas
// válidas (ids 1..6); las 6 restantes (7,9,11,12,14,15) no tienen lat/lng
// numéricos (location:[] o sin la clave) y se descartan sin lanzar.
// ---------------------------------------------------------------------------
describe('listShopsNear (US-5)', () => {
  const SIN_COORDENADAS = [7, 9, 11, 12, 14, 15];

  it('dos orígenes distintos dan órdenes de ids distintos, ≤6 filas, sin ids sin coordenadas', async () => {
    const desdeNY = await listShopsNear(40.7128, -74.006);
    const desdeBogota = await listShopsNear(4.711, -74.0721);

    expect(desdeNY.length).toBeLessThanOrEqual(6);
    expect(desdeBogota.length).toBeLessThanOrEqual(6);

    for (const shop of [...desdeNY, ...desdeBogota]) {
      expect(SIN_COORDENADAS).not.toContain(shop.id);
      expect(Number.isFinite(shop.distanceKm)).toBe(true);
    }

    // Orden ascendente por distancia en ambos.
    for (const arr of [desdeNY, desdeBogota]) {
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i].distanceKm).toBeGreaterThanOrEqual(arr[i - 1].distanceKm);
      }
    }

    // Orígenes lejanos entre sí → órdenes de ids distintos (B-1: cercanía real).
    expect(desdeNY.map((s) => s.id)).not.toEqual(desdeBogota.map((s) => s.id));
  });

  it('lat/lng no finitos (NaN) → [] sin lanzar (B-4, guard en el repositorio)', async () => {
    expect(await listShopsNear(Number.NaN, Number.NaN)).toEqual([]);
  });

  it('no-regresión: listShops sigue en total 12, items[0].id === 15', async () => {
    const { items, total } = await listShops();
    expect(total).toBe(12);
    expect(items[0].id).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// US-30: escrituras (camino feliz, PR#1). Los describes de escritura van
// DESPUÉS de los de lectura (vitest ejecuta los `describe` en orden de
// archivo), así que el no-regresión de arriba corre antes de que exista
// ningún centinela. `ownerId: 3` en todos (DD30-6): dueño de cero tiendas
// hoy. Cada `it` borra lo que crea.
// ---------------------------------------------------------------------------
describe('createShop / updateShop / setShopActive (escritura, US-30)', () => {
  it('crea con is_active por rol: store_owner (false) y super_admin (true)', async () => {
    const inactive = await createShop({
      name: `${SENTINEL_PREFIX}store-owner`,
      ownerId: 3,
      isActive: false,
    });
    expect(inactive.slug).toBe(`${SENTINEL_PREFIX}store-owner`);
    expect(inactive.ownerId).toBe(3);
    expect(inactive.isActive).toBe(false);
    expect(inactive.productsCount).toBe(0);

    const active = await createShop({
      name: `${SENTINEL_PREFIX}super-admin`,
      ownerId: 3,
      isActive: true,
    });
    expect(active.isActive).toBe(true);
    expect(active.productsCount).toBe(0);

    await prisma.shop.deleteMany({
      where: { id: { in: [inactive.id, active.id] } },
    });
  });

  it('edita name/description/logo/cover_image/address/settings campo a campo, slug invariante', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}editable`,
      ownerId: 3,
      isActive: false,
    });

    const updated = await updateShop(created.id, {
      name: `${SENTINEL_PREFIX}editable-renombrada`,
      description: 'descripción actualizada',
      logo: { thumbnail: 'x.png', original: 'x-original.png' },
      coverImage: { thumbnail: 'y.png', original: 'y-original.png' },
      address: { city: 'Bogotá', country: 'CO' },
      settings: { contact: { phone: '3000000000' } },
    });

    expect(updated.name).toBe(`${SENTINEL_PREFIX}editable-renombrada`);
    expect(updated.description).toBe('descripción actualizada');
    expect(updated.logo).toEqual({
      thumbnail: 'x.png',
      original: 'x-original.png',
    });
    expect(updated.coverImage).toEqual({
      thumbnail: 'y.png',
      original: 'y-original.png',
    });
    expect(updated.address).toEqual({ city: 'Bogotá', country: 'CO' });
    expect(updated.settings).toEqual({ contact: { phone: '3000000000' } });
    // CA-2 / DD30-2: slug invariante pese a cambiar `name`.
    expect(updated.slug).toBe(`${SENTINEL_PREFIX}editable`);

    await prisma.shop.delete({ where: { id: created.id } });
  });

  it('setShopActive togglea is_active (approve/disapprove)', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}toggle`,
      ownerId: 3,
      isActive: false,
    });
    expect(created.isActive).toBe(false);

    const approved = await setShopActive(created.id, true);
    expect(approved.isActive).toBe(true);
    expect(approved.slug).toBe(created.slug);

    const disapproved = await setShopActive(created.id, false);
    expect(disapproved.isActive).toBe(false);

    await prisma.shop.delete({ where: { id: created.id } });
  });
});

// ---------------------------------------------------------------------------
// D30-4 / DD30-5: `productsCount` en una escritura debe coincidir con el de
// la lectura, nunca `0` por el `?? 0` de `shops.service.ts`. Única mutación
// sobre el seed: `gadget.updated_at` (ninguna prueba lee esa columna). El id
// se resuelve por slug, nunca hardcodeado.
// ---------------------------------------------------------------------------
describe('productsCount en updateShop (D30-4)', () => {
  it('un update idempotente sobre "gadget" conserva sus datos y trae productsCount 44', async () => {
    const before = await findShopBySlug('gadget');
    if (!before) throw new Error('seed sin la tienda "gadget"');

    const updated = await updateShop(before.id, {
      description: before.description,
    });

    expect(updated.productsCount).toBe(44);
    expect(updated.name).toBe(before.name);
    expect(updated.slug).toBe(before.slug);
    expect(updated.description).toBe(before.description);
    expect(updated.isActive).toBe(before.isActive);
  });
});

// ---------------------------------------------------------------------------
// US-30, PR#2: batería hostil de integración. Excluye deliberadamente "id no
// entero" — su precondición documentada es un id ya guardado por el
// llamador (DD30-3); ese `it` vive en PR#4 (jest), sobre `@Body('id')` del
// servicio. `ownerId: 3` en todos los centinelas (DD30-6). Cada `it` borra
// lo que crea.
// ---------------------------------------------------------------------------

describe('404 de P2025 en updateShop/setShopActive con id borrado (DD30-10)', () => {
  it('updateShop(id borrado, …) → RecordNotFoundError', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}404-update`,
      ownerId: 3,
      isActive: false,
    });
    await prisma.shop.delete({ where: { id: created.id } });

    await expect(
      updateShop(created.id, { description: 'no debería escribirse' })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('setShopActive(id borrado, …) → RecordNotFoundError', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}404-toggle`,
      ownerId: 3,
      isActive: false,
    });
    await prisma.shop.delete({ where: { id: created.id } });

    await expect(setShopActive(created.id, true)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('409 de slug duplicado (P2002, solo por carrera) y 400 de owner_id inexistente (P2003, DD30-10)', () => {
  it('dos createShop concurrentes con el mismo name: uno gana, el otro → SlugConflictError', async () => {
    // `createShop` deriva el slug de `name` vía `generateSlug`: un duplicado
    // NUNCA es alcanzable en secuencia (el segundo `POST` recibiría un
    // sufijo `-2`). Es "solo por carrera" (`slug.ts:66-68`): dos llamadas
    // que arrancan a la vez consultan `shopSlugs` antes de que cualquiera
    // haya hecho `INSERT`, ambas calculan el mismo candidato base, y solo
    // una gana el `UNIQUE` de Postgres — la otra recibe `P2002`.
    const name = `${SENTINEL_PREFIX}carrera-slug`;
    const [r1, r2] = await Promise.allSettled([
      createShop({ name, ownerId: 3, isActive: false }),
      createShop({ name, ownerId: 3, isActive: false }),
    ]);

    const winner = r1.status === 'fulfilled' ? r1 : r2.status === 'fulfilled' ? r2 : null;
    const loser = r1.status === 'rejected' ? r1 : r2.status === 'rejected' ? r2 : null;

    expect(winner).not.toBeNull();
    expect(loser).not.toBeNull();
    if (loser) expect(loser.reason).toBeInstanceOf(SlugConflictError);
    if (winner) await prisma.shop.delete({ where: { id: winner.value.id } });
  });

  it('owner_id inexistente → InvalidReferenceError vía P2003, mensaje "shops.desconocida" (DD30-10, sin uniqueField)', async () => {
    let error: unknown;
    try {
      await createShop({
        name: `${SENTINEL_PREFIX}owner-fantasma`,
        ownerId: 999999999,
        isActive: false,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidReferenceError);
    // Bajo Prisma 7 + adapter-pg un P2003 llega sin `meta.field_name`
    // (verificado en runtime, no solo leído en `translateCatalogWriteError`):
    // el mensaje culpa a `desconocida`, divergencia ya declarada en US-28.
    expect((error as Error).message).toContain('shops.desconocida');
  });
});

describe('REPLACE completo de settings (D30-1, ratificada) y no-op de logo/cover_image (DD30-2/DD30-4)', () => {
  const NULL_JSON = null as unknown as Prisma.InputJsonValue;

  it('un segundo PUT sin un sub-campo previo de settings lo BORRA — la pérdida se demuestra, no se oculta (D30-1)', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}settings-replace`,
      ownerId: 3,
      isActive: false,
      settings: {
        shopMaintenance: { isUnderMaintenance: true },
        contact: { phone: '3000000000' },
      },
    });
    expect(created.settings).toEqual({
      shopMaintenance: { isUnderMaintenance: true },
      contact: { phone: '3000000000' },
    });

    // El segundo PUT llega sin `shopMaintenance` (el formulario del admin no
    // monta ese bloque para su rol, `shouldUnregister: true`): REPLACE
    // completo, no merge. La pérdida de `shopMaintenance` es la propiedad
    // declarada del comportamiento nuevo, no una regresión.
    const updated = await updateShop(created.id, {
      settings: { contact: { phone: '3111111111' } },
    });
    expect(updated.settings).toEqual({ contact: { phone: '3111111111' } });
    expect(updated.settings).not.toHaveProperty('shopMaintenance');

    await prisma.shop.delete({ where: { id: created.id } });
  });

  it('logo: null y cover_image: null son no-op — la columna almacenada no cambia, otros campos del mismo PUT sí se aplican', async () => {
    const LOGO = { thumbnail: 'l.png', original: 'l-original.png' };
    const COVER = { thumbnail: 'c.png', original: 'c-original.png' };
    const created = await createShop({
      name: `${SENTINEL_PREFIX}logo-noop`,
      ownerId: 3,
      isActive: false,
      logo: LOGO,
      coverImage: COVER,
    });
    expect(created.logo).toEqual(LOGO);
    expect(created.coverImage).toEqual(COVER);

    const updated = await updateShop(created.id, {
      logo: NULL_JSON,
      coverImage: NULL_JSON,
      description: 'no-op de logo/cover, este campo sí escribe',
    });
    expect(updated.logo).toEqual(LOGO);
    expect(updated.coverImage).toEqual(COVER);
    expect(updated.description).toBe(
      'no-op de logo/cover, este campo sí escribe'
    );

    await prisma.shop.delete({ where: { id: created.id } });
  });
});

describe('Monotonía de updated_at: solo update→update y setActive→setActive, nunca create-vs-update (DD30-7)', () => {
  // Mismo rationale que `products.integration.test.ts:517-567`:
  // `createShop` liga `created_at`/`updated_at` como parámetros del INSERT
  // desde Node (`schema.prisma` sin `@updatedAt`), mientras que `updateShop`/
  // `setShopActive` dejan la columna al trigger `shops_updated_at`, con el
  // reloj de Postgres. Comparar create-vs-update mezcla dos relojes que
  // divergen en vivo — NUNCA se hace aquí. `toBeGreaterThan` estricto: con
  // `>=`, un trigger que no dispara produce una igualdad y el test pasaría
  // igual.
  it('updateShop → updateShop: updatedAt estrictamente creciente', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}monotonia-update`,
      ownerId: 3,
      isActive: false,
    });

    const firstUpdate = await updateShop(created.id, { description: 'primera' });
    const secondUpdate = await updateShop(created.id, { description: 'segunda' });

    expect(secondUpdate.updatedAt.getTime()).toBeGreaterThan(
      firstUpdate.updatedAt.getTime()
    );

    await prisma.shop.delete({ where: { id: created.id } });
  });

  it('setShopActive → setShopActive (approve → disapprove): updatedAt estrictamente creciente', async () => {
    const created = await createShop({
      name: `${SENTINEL_PREFIX}monotonia-toggle`,
      ownerId: 3,
      isActive: false,
    });

    const approved = await setShopActive(created.id, true);
    const disapproved = await setShopActive(created.id, false);

    expect(disapproved.updatedAt.getTime()).toBeGreaterThan(
      approved.updatedAt.getTime()
    );

    await prisma.shop.delete({ where: { id: created.id } });
  });
});

// ---------------------------------------------------------------------------
// Tripwire (DD30-6): NO puede apoyarse en `listShops`, que filtra
// `isActive: input.isActive ?? true` — las 12 filas del seed están todas
// activas, así que una centinela INACTIVA superviviente (el caso normal de
// esta US) dejaría `toBe(12)`/`id 15` en verde por `listShops()`. La forma
// normativa cuenta sin filtro y verifica la cola de moderación vacía.
//
// VA EL ÚLTIMO A PROPÓSITO. El diseño lo exige y PR#2 lo había dejado a
// media altura del archivo, custodiando solo el primer describe de escritura:
// los seis que venían después quedaban sin red. vitest ejecuta los `describe`
// de un archivo en orden de declaración, así que solo desde el final cubre
// toda la batería. Al añadir un describe de escritura nuevo, va ANTES de este.
// ---------------------------------------------------------------------------
describe('tripwire: rollback de escritura restituye el seed', () => {
  it('12 filas sin filtro, cola de moderación vacía, id 15 al frente', async () => {
    expect(await prisma.shop.count()).toBe(12);
    expect((await listShops({ isActive: false })).total).toBe(0);
    expect((await listShops()).items[0].id).toBe(15);
  });
});
