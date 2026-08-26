/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 198 categorías = 83 raíces + 109
 * hijas + 6 nietas). Solo lectura: no escribe ninguna fila, así que no
 * necesita `afterAll` de limpieza — sí `prisma.$disconnect()`.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import {
  findCategoryByIdOrSlug,
  getCategoryTree,
  listCategories,
} from './categories.repository';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listCategories — conteos del seed', () => {
  it('rootsOnly true (default) → 83 raíces', async () => {
    const { total } = await listCategories({ limit: 1000 });
    expect(total).toBe(83);
  });

  it('rootsOnly false → 198 nodos planos (D-4)', async () => {
    const { total } = await listCategories({ rootsOnly: false, limit: 1000 });
    expect(total).toBe(198);
  });
});

describe('listCategories — profundidad 3 explícita (el test que habría cazado el bug)', () => {
  it('124 → [163,164] → 163 anidado trae [169,170], 169 anidado trae brown-eggs', async () => {
    const { items, total } = await listCategories({
      rootsOnly: false,
      typeSlug: 'daily-needs',
      limit: 1000,
    });
    expect(total).toBe(53);

    const root124 = items.find((n) => n.id === 124);
    expect(root124).toBeDefined();
    expect(root124?.children.map((c) => c.id)).toEqual([163, 164]);

    const nested163 = root124?.children.find((c) => c.id === 163);
    expect(nested163).toBeDefined();
    expect(nested163?.children.map((c) => c.id)).toEqual([169, 170]);

    const nested169 = nested163?.children.find((c) => c.id === 169);
    expect(nested169).toBeDefined();
    expect(nested169?.slug).toBe('brown-eggs');
    expect(nested169).toHaveProperty('icon');
    expect(nested169).toHaveProperty('image');
  });
});

describe('listCategories — no hay bisnietos', () => {
  it('profundidad máxima 2, y la suma de nodos únicos visitados es 198', async () => {
    const { items } = await listCategories({ rootsOnly: true, limit: 1000 });
    const visited = new Set<number>();
    let maxDepth = 0;

    const walk = (
      node: { id: number; children: { id: number; children: unknown[] }[] },
      depth: number
    ) => {
      visited.add(node.id);
      maxDepth = Math.max(maxDepth, depth);
      for (const child of node.children) {
        walk(child as never, depth + 1);
      }
    };
    for (const root of items) walk(root as never, 0);

    expect(maxDepth).toBe(2);
    expect(visited.size).toBe(198);
  });
});

describe('listCategories — cadena ascendente (D-2)', () => {
  it('169: parent.id 163, parent.parent.id 124, parent.parent.parent null; ancestros sin children', async () => {
    const { items } = await listCategories({ rootsOnly: false, limit: 1000 });
    const node169 = items.find((n) => n.id === 169);
    expect(node169).toBeDefined();
    expect(node169?.parent?.id).toBe(163);
    expect(node169?.parent?.parent?.id).toBe(124);
    expect(node169?.parent?.parent?.parent).toBeNull();
    expect('children' in (node169?.parent ?? {})).toBe(false);
  });
});

describe('listCategories — aciclidad (R-1)', () => {
  it('JSON.stringify del listado completo sin paginar no lanza', async () => {
    const { items } = await listCategories({ rootsOnly: false, limit: 1000 });
    expect(() => JSON.stringify(items)).not.toThrow();
  });
});

describe('listCategories — typeSlug + paginación', () => {
  it('typeSlug gadget → total 10 (las 10 raíces hoja) con rootsOnly en cualquier valor', async () => {
    const rootsOnly = await listCategories({ typeSlug: 'gadget', limit: 1000 });
    expect(rootsOnly.total).toBe(10);

    const flat = await listCategories({
      typeSlug: 'gadget',
      rootsOnly: false,
      limit: 1000,
    });
    expect(flat.total).toBe(10);
  });

  it('page 2, limit 50, rootsOnly false sobre daily-needs → 3 items sin ids repetidos con la página 1', async () => {
    const page1 = await listCategories({
      typeSlug: 'daily-needs',
      rootsOnly: false,
      page: 1,
      limit: 50,
    });
    const page2 = await listCategories({
      typeSlug: 'daily-needs',
      rootsOnly: false,
      page: 2,
      limit: 50,
    });
    expect(page2.items).toHaveLength(3);
    const ids1 = new Set(page1.items.map((n) => n.id));
    for (const n of page2.items) expect(ids1.has(n.id)).toBe(false);
  });
});

describe('listCategories — name (Decisión G)', () => {
  it("name 'egg' case-insensitive → total > 0 y todo item con 'egg' en el nombre", async () => {
    const { items, total } = await listCategories({
      name: 'egg',
      rootsOnly: false,
      limit: 1000,
    });
    expect(total).toBeGreaterThan(0);
    for (const n of items) {
      expect(n.name.toLowerCase()).toContain('egg');
    }
  });
});

describe('findCategoryByIdOrSlug', () => {
  it('id ≡ slug: 124 y dairy-2 devuelven el mismo id y el mismo árbol', async () => {
    const byId = await findCategoryByIdOrSlug('124');
    const bySlug = await findCategoryByIdOrSlug('dairy-2');
    expect(byId).not.toBeNull();
    expect(bySlug).not.toBeNull();
    expect(byId?.id).toBe(bySlug?.id);
    expect(JSON.stringify(byId)).toBe(JSON.stringify(bySlug));
  });

  it('nieta por slug: brown-eggs → id 169, parentId 163, parent.parent.id 124', async () => {
    const node = await findCategoryByIdOrSlug('brown-eggs');
    expect(node?.id).toBe(169);
    expect(node?.parentId).toBe(163);
    expect(node?.parent?.parent?.id).toBe(124);
  });

  it('ausente → null (dispara el 404 del servicio)', async () => {
    expect(await findCategoryByIdOrSlug('no-existe-ni-existira')).toBeNull();
  });
});

describe('getCategoryTree — compatibilidad (R-4)', () => {
  it('83 raíces, todas con parentId null, y alguna con children.length > 0', async () => {
    const tree = await getCategoryTree();
    expect(tree).toHaveLength(83);
    for (const root of tree) expect(root.parentId).toBeNull();
    expect(tree.some((root) => root.children.length > 0)).toBe(true);
  });
});
