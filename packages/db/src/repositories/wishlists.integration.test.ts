/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 10 favoritos de customer@demo.com, id 2, en el orden 945 → 104). US-53.
 *
 * Las escrituras usan las listas del admin (3) y del dueño (1), que el seed
 * deja vacías; `beforeAll`/`afterAll` las vacían. La lista del cliente no se
 * modifica.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { RecordNotFoundError } from '../domain-errors';
import {
  addToWishlist,
  findWishlistProduct,
  isInWishlist,
  listWishlistProducts,
  removeFromWishlist,
  toggleWishlist,
} from './wishlists.repository';

const OWNER = 1;
const CUSTOMER = 2;
const ADMIN = 3;
const SEED_ORDER = [945, 941, 755, 569, 400, 313, 155, 111, 110, 104];

const cleanup = () =>
  prisma.wishlist.deleteMany({ where: { userId: { in: [OWNER, ADMIN] } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listWishlistProducts / isInWishlist — seed', () => {
  it('los 10 favoritos del cliente en created_at DESC, hidratados como ProductRecord', async () => {
    const { items, total } = await listWishlistProducts(CUSTOMER);
    expect(total).toBe(10);
    expect(items.map((p) => p.id)).toEqual(SEED_ORDER);
    expect(items[0].shop.id).toBe(7);
    expect(items[0].type.slug).toBeTruthy();
  });

  it('pagina con limit 30 por defecto y respeta page/limit', async () => {
    const page2 = await listWishlistProducts(CUSTOMER, { page: 2, limit: 4 });
    expect(page2.items.map((p) => p.id)).toEqual(SEED_ORDER.slice(4, 8));
    expect(page2.total).toBe(10);
  });

  it('la lista es por usuario', async () => {
    expect((await listWishlistProducts(ADMIN)).total).toBe(0);
    expect(await isInWishlist(CUSTOMER, 945)).toBe(true);
    expect(await isInWishlist(ADMIN, 945)).toBe(false);
    expect((await findWishlistProduct(CUSTOMER, 104))?.id).toBe(104);
    expect(await findWishlistProduct(ADMIN, 104)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('toggleWishlist', () => {
  it('invierte la pertenencia solo para el usuario que llama', async () => {
    expect(await toggleWishlist(ADMIN, 945)).toBe(true);
    expect(await isInWishlist(ADMIN, 945)).toBe(true);
    expect((await listWishlistProducts(CUSTOMER)).total).toBe(10);
    expect(await toggleWishlist(ADMIN, 945)).toBe(false);
    expect(await isInWishlist(ADMIN, 945)).toBe(false);
    expect(await isInWishlist(CUSTOMER, 945)).toBe(true);
  });

  it('producto inexistente ⇒ RecordNotFoundError', async () => {
    await expect(toggleWishlist(ADMIN, 999_999)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('addToWishlist / removeFromWishlist', () => {
  it('añadir es idempotente y el más reciente sale primero', async () => {
    expect((await addToWishlist(OWNER, 3)).id).toBe(3);
    await addToWishlist(OWNER, 3);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addToWishlist(OWNER, 2);
    const { items, total } = await listWishlistProducts(OWNER);
    expect(total).toBe(2);
    expect(items.map((p) => p.id)).toEqual([2, 3]);
  });

  it('quitar devuelve el producto; repetirlo o un producto inexistente ⇒ RecordNotFoundError', async () => {
    expect((await removeFromWishlist(OWNER, 3)).id).toBe(3);
    await expect(removeFromWishlist(OWNER, 3)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    await expect(addToWishlist(OWNER, 999_999)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    expect((await listWishlistProducts(OWNER)).items.map((p) => p.id)).toEqual([
      2,
    ]);
  });
});
