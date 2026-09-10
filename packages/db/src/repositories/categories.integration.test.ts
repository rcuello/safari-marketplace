/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 198 categorías = 83 raíces + 109
 * hijas + 6 nietas).
 *
 * Los describes de LECTURA (sin modificar) van primero y afirman conteos
 * exactos del seed — `toBe(198)`, `toBe(83)`, `toBe(53)`, `toBe(10)` — que
 * corren antes de que exista ninguna fila centinela. Los describes de
 * ESCRITURA (US-28) van al final, operan 100% sobre un centinela propio
 * `zz-categories-` en `slug`/`name` (design.md, DD28-8) y cada `it` borra
 * lo que crea, además de la red del `beforeAll`/`afterAll` de abajo.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { EmptySlugError, InvalidReferenceError, RecordNotFoundError } from '../domain-errors';
import { _id } from '../records';
import {
  createCategory,
  deleteCategory,
  findCategoryByIdOrSlug,
  getCategoryTree,
  listCategories,
  updateCategory,
} from './categories.repository';

const SENTINEL_PREFIX = 'zz-categories-';

const cleanup = () =>
  prisma.category.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

/** `daily-needs` y `gadget` — dos types reales y distintos del seed, para
 * las reglas 4/7 (madre/hija de otro `type_id`). Resueltos por slug en vez
 * de hardcodear el id: sobreviven a un `db-reset` que reordene el seed. */
let TYPE_A: number;
let TYPE_B: number;

beforeAll(async () => {
  await cleanup(); // corrida abortada previa
  const [typeA, typeB] = await Promise.all([
    prisma.type.findUniqueOrThrow({ where: { slug: 'daily-needs' } }),
    prisma.type.findUniqueOrThrow({ where: { slug: 'gadget' } }),
  ]);
  TYPE_A = _id(typeA.id);
  TYPE_B = _id(typeB.id);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
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

// ---------------------------------------------------------------------------
// Escrituras (US-28) — centinela zz-categories-, describes al final.
// ---------------------------------------------------------------------------

describe('createCategory — CA-1, centinela zz-categories-', () => {
  it('crea una raíz y sobrevive a una relectura por slug (_loadNode)', async () => {
    const created = await createCategory({
      name: `${SENTINEL_PREFIX}raiz`,
      slug: `${SENTINEL_PREFIX}raiz`,
      typeId: TYPE_A,
    });

    expect(created.parentId).toBeNull();
    expect(created.parent).toBeNull();
    expect(created.type.id).toBe(TYPE_A);

    const reread = await findCategoryByIdOrSlug(created.slug);
    expect(reread?.id).toBe(created.id);

    await deleteCategory(created.id);
  });

  it('crea una hija bajo una madre centinela del mismo type_id', async () => {
    const parent = await createCategory({
      name: `${SENTINEL_PREFIX}madre`,
      slug: `${SENTINEL_PREFIX}madre`,
      typeId: TYPE_A,
    });
    const child = await createCategory({
      name: `${SENTINEL_PREFIX}hija-create`,
      slug: `${SENTINEL_PREFIX}hija-create`,
      typeId: TYPE_A,
      parentId: parent.id,
    });

    expect(child.parentId).toBe(parent.id);
    expect(child.parent?.id).toBe(parent.id);

    const parentReread = await findCategoryByIdOrSlug(parent.slug);
    expect(parentReread?.children.map((c) => c.id)).toContain(child.id);

    await deleteCategory(child.id);
    await deleteCategory(parent.id);
  });

  it('colisión de slug explícito agrega sufijo incremental (-2)', async () => {
    const first = await createCategory({
      name: `${SENTINEL_PREFIX}Duplicada`,
      slug: `${SENTINEL_PREFIX}dup`,
      typeId: TYPE_A,
    });
    const second = await createCategory({
      name: `${SENTINEL_PREFIX}Duplicada`,
      slug: `${SENTINEL_PREFIX}dup`,
      typeId: TYPE_A,
    });

    expect(second.slug).toBe(`${SENTINEL_PREFIX}dup-2`);

    await deleteCategory(first.id);
    await deleteCategory(second.id);
  });
});

describe('updateCategory — CA-2, slug inmutable, updatedAt por trigger de base', () => {
  it('renombrar no cambia el slug; updated_at avanza (monotonía entre dos PUT sucesivos, ambos por el reloj de la base, DD28-7)', async () => {
    // La comparación es UPDATE-vs-UPDATE, nunca create-vs-update: `created.updatedAt`
    // lo computa Prisma Client en Node (comportamiento estándar de `@default(now())`
    // en prisma/schema.prisma, confirmado con `log:['query']` — el INSERT trae
    // `created_at`/`updated_at` como parámetros ligados, no delegados al DEFAULT
    // de la columna), mientras que `updateCategory` SÍ delega en el trigger de
    // Postgres (DD28-7). Comparar create vs update mezcla dos relojes distintos
    // (Node del proceso vs Postgres del contenedor) y, verificado empíricamente
    // en este entorno (Docker Desktop/Windows), pueden divergir varios cientos
    // de ms — un hallazgo real para `design.md`, no un flake a ignorar. Dos
    // `PUT` sucesivos comparados entre sí SÍ usan el mismo reloj (el trigger,
    // ambas veces) y son monótonos de forma fiable.
    const created = await createCategory({
      name: `${SENTINEL_PREFIX}Original`,
      slug: `${SENTINEL_PREFIX}original`,
      typeId: TYPE_A,
    });

    const firstUpdate = await updateCategory(created.id, {
      name: `${SENTINEL_PREFIX}Renombrada`,
    });
    expect(firstUpdate.name).toBe(`${SENTINEL_PREFIX}Renombrada`);
    expect(firstUpdate.slug).toBe(`${SENTINEL_PREFIX}original`);

    const secondUpdate = await updateCategory(created.id, {
      name: `${SENTINEL_PREFIX}Renombrada Otra Vez`,
    });
    expect(secondUpdate.slug).toBe(`${SENTINEL_PREFIX}original`);
    // `toBeGreaterThan`, NUNCA `toBeGreaterThanOrEqual` (gate corrective,
    // finding 2): con `>=`, el fallo exacto que este test existe para cazar
    // — el trigger `categories_updated_at` sin disparar, `updated_at`
    // congelado en su valor de INSERT — produce una IGUALDAD exacta y el
    // test PASA igual. El spec (`category-tree-api/spec.md:30-31,38`) exige
    // «avanza»/«posterior», no «no retrocede». Delta medido entre dos `PUT`
    // sucesivos: 17-45ms según la corrida — nunca cero — así que `>` estricto
    // es estable.
    expect(secondUpdate.updatedAt.getTime()).toBeGreaterThan(
      firstUpdate.updatedAt.getTime()
    );

    await deleteCategory(created.id);
  });

  it('name vacío ⇒ EmptySlugError y la fila queda intacta', async () => {
    const created = await createCategory({
      name: `${SENTINEL_PREFIX}Intacta`,
      slug: `${SENTINEL_PREFIX}intacta`,
      typeId: TYPE_A,
    });

    await expect(updateCategory(created.id, { name: '' })).rejects.toBeInstanceOf(
      EmptySlugError
    );

    const reread = await findCategoryByIdOrSlug(`${SENTINEL_PREFIX}intacta`);
    expect(reread?.name).toBe(`${SENTINEL_PREFIX}Intacta`);

    await deleteCategory(created.id);
  });

  it('mueve una categoría a otra madre centinela válida del mismo type', async () => {
    const [a, b] = await Promise.all([
      createCategory({
        name: `${SENTINEL_PREFIX}Mover A`,
        slug: `${SENTINEL_PREFIX}mover-a`,
        typeId: TYPE_A,
      }),
      createCategory({
        name: `${SENTINEL_PREFIX}Mover B`,
        slug: `${SENTINEL_PREFIX}mover-b`,
        typeId: TYPE_A,
      }),
    ]);

    const moved = await updateCategory(a.id, { parentId: b.id });
    expect(moved.parentId).toBe(b.id);
    expect(moved.parent?.id).toBe(b.id);

    const bReread = await findCategoryByIdOrSlug(b.slug);
    expect(bReread?.children.map((c) => c.id)).toContain(a.id);

    await deleteCategory(a.id);
    await deleteCategory(b.id);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      updateCategory(999999, { name: `${SENTINEL_PREFIX}Fantasma` })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('Las siete reglas de la arista madre→hija — 400 (InvalidReferenceError), nunca 500 (DD28-3)', () => {
  it('regla 1 (type_id): forma no entera en create → InvalidReferenceError, nunca BigInt(NaN)', async () => {
    await expect(
      createCategory({
        name: `${SENTINEL_PREFIX}bad-type`,
        typeId: Number('abc'),
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('regla 1 (parent): forma no entera en create → InvalidReferenceError ANTES del dispatch `parentId != null`', async () => {
    await expect(
      createCategory({
        name: `${SENTINEL_PREFIX}bad-parent`,
        typeId: TYPE_A,
        parentId: Number('abc'),
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('regla 3: madre inexistente → InvalidReferenceError', async () => {
    await expect(
      createCategory({
        name: `${SENTINEL_PREFIX}madre-fantasma`,
        typeId: TYPE_A,
        parentId: 999999,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('regla 4: madre de otro type_id → InvalidReferenceError', async () => {
    const parent = await createCategory({
      name: `${SENTINEL_PREFIX}Madre Type A`,
      slug: `${SENTINEL_PREFIX}madre-type-a`,
      typeId: TYPE_A,
    });

    await expect(
      createCategory({
        name: `${SENTINEL_PREFIX}hija-type-b`,
        typeId: TYPE_B,
        parentId: parent.id,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await deleteCategory(parent.id);
  });

  it('regla 2: autorreferencia (parent === id) en update → InvalidReferenceError', async () => {
    const node = await createCategory({
      name: `${SENTINEL_PREFIX}Auto`,
      slug: `${SENTINEL_PREFIX}auto`,
      typeId: TYPE_A,
    });

    await expect(
      updateCategory(node.id, { parentId: node.id })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    const reread = await findCategoryByIdOrSlug(node.slug);
    expect(reread?.parentId).toBeNull();

    await deleteCategory(node.id);
  });

  it('reglas 5/6: ciclo A→B→A en update → InvalidReferenceError (única red que atrapa un `_id()` faltante, DD28-4)', async () => {
    const a = await createCategory({
      name: `${SENTINEL_PREFIX}Ciclo A`,
      slug: `${SENTINEL_PREFIX}ciclo-a`,
      typeId: TYPE_A,
    });
    const b = await createCategory({
      name: `${SENTINEL_PREFIX}Ciclo B`,
      slug: `${SENTINEL_PREFIX}ciclo-b`,
      typeId: TYPE_A,
      parentId: a.id,
    });

    await expect(
      updateCategory(a.id, { parentId: b.id })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    const aReread = await findCategoryByIdOrSlug(a.slug);
    expect(aReread?.parentId).toBeNull();

    await deleteCategory(b.id);
    await deleteCategory(a.id);
  });

  it('regla 7: cambiar type_id en un nodo CON hijas → 400; la misma operación en una hoja → 200 (DD28-5)', async () => {
    const parentWithChild = await createCategory({
      name: `${SENTINEL_PREFIX}Con Hijas`,
      slug: `${SENTINEL_PREFIX}con-hijas`,
      typeId: TYPE_A,
    });
    const child = await createCategory({
      name: `${SENTINEL_PREFIX}Con Hijas Hija`,
      slug: `${SENTINEL_PREFIX}con-hijas-hija`,
      typeId: TYPE_A,
      parentId: parentWithChild.id,
    });

    await expect(
      updateCategory(parentWithChild.id, { typeId: TYPE_B })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    const leaf = await createCategory({
      name: `${SENTINEL_PREFIX}Hoja`,
      slug: `${SENTINEL_PREFIX}hoja`,
      typeId: TYPE_A,
    });
    const retyped = await updateCategory(leaf.id, { typeId: TYPE_B });
    expect(retyped.typeId).toBe(TYPE_B);

    await deleteCategory(child.id);
    await deleteCategory(parentWithChild.id);
    await deleteCategory(leaf.id);
  });
});

describe('FK type_id inexistente (P2003) — InvalidReferenceError con field distinto de `slug` (gate corrective, finding 3)', () => {
  // `_assertIntegerRef` solo valida FORMA entera de `type_id`, nunca su
  // EXISTENCIA (design.md no lo pide — la tabla de errores lo deja al FK
  // `categories_type_id_fkey`, alcanzable por POST y PUT). Este es el camino
  // que expuso el finding 1: bajo Prisma 7 + adapter-pg, `P2003` llega SIN
  // `meta.field_name`, y `translateCatalogWriteError` (`domain-errors.ts:150-156`)
  // caía al `uniqueField` fijo del `catch` — `'slug'` — culpando al campo
  // equivocado. Tras quitar `uniqueField: 'slug'` de ambos catches, el campo
  // cae al `'desconocida'` genérico y honesto de la casa (precedente
  // `createTag`), nunca `slug`.
  it('createCategory con type_id inexistente → InvalidReferenceError, el mensaje NO culpa a `slug`', async () => {
    let error: unknown;
    try {
      await createCategory({
        name: `${SENTINEL_PREFIX}fk-type-fantasma`,
        typeId: 999999,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(InvalidReferenceError);
    const message = (error as Error).message;
    expect(message).not.toContain('.slug');

    // Nada se creó: si el guard fallara y se llegara a insertar, esto lo cazaría.
    expect(
      await findCategoryByIdOrSlug(`${SENTINEL_PREFIX}fk-type-fantasma`)
    ).toBeNull();
  });
});

describe('deleteCategory — CA-3, snapshot pre-borrado y re-enraizado por la base', () => {
  it('borra una madre centinela con hijas: el snapshot trae la hija con su parent_id previo; la base ya re-enraizó', async () => {
    const parent = await createCategory({
      name: `${SENTINEL_PREFIX}Borrar Madre`,
      slug: `${SENTINEL_PREFIX}borrar-madre`,
      typeId: TYPE_A,
    });
    const child = await createCategory({
      name: `${SENTINEL_PREFIX}Borrar Hija`,
      slug: `${SENTINEL_PREFIX}borrar-hija`,
      typeId: TYPE_A,
      parentId: parent.id,
    });

    const snapshot = await deleteCategory(parent.id);
    expect(snapshot.children.map((c) => c.id)).toContain(child.id);
    expect(snapshot.children.find((c) => c.id === child.id)?.parentId).toBe(
      parent.id
    );

    const childReread = await findCategoryByIdOrSlug(child.slug);
    expect(childReread?.parentId).toBeNull();
    expect(childReread?.parent).toBeNull();

    expect(await findCategoryByIdOrSlug(parent.slug)).toBeNull();

    await deleteCategory(child.id);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(deleteCategory(999999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('CA-4 — profundidad 4 servida de extremo a extremo (confirmación empírica de D28-7)', () => {
  it('cadena centinela raíz→hija→nieta→bisnieta, 100% centinela, se sirve anidada a 4 niveles', async () => {
    const raiz = await createCategory({
      name: `${SENTINEL_PREFIX}Raiz4`,
      slug: `${SENTINEL_PREFIX}raiz4`,
      typeId: TYPE_A,
    });
    const hija = await createCategory({
      name: `${SENTINEL_PREFIX}Hija4`,
      slug: `${SENTINEL_PREFIX}hija4`,
      typeId: TYPE_A,
      parentId: raiz.id,
    });
    const nieta = await createCategory({
      name: `${SENTINEL_PREFIX}Nieta4`,
      slug: `${SENTINEL_PREFIX}nieta4`,
      typeId: TYPE_A,
      parentId: hija.id,
    });
    // Si esto lanzara 400 en vez de crear, D28-7 se desmentiría — no se asume,
    // se ejercita: la ausencia de `rejects` ya es la evidencia.
    const bisnieta = await createCategory({
      name: `${SENTINEL_PREFIX}Bisnieta4`,
      slug: `${SENTINEL_PREFIX}bisnieta4`,
      typeId: TYPE_A,
      parentId: nieta.id,
    });
    expect(bisnieta.parentId).toBe(nieta.id);

    const raizReread = await findCategoryByIdOrSlug(raiz.slug);
    const hijaNode = raizReread?.children.find((c) => c.id === hija.id);
    const nietaNode = hijaNode?.children.find((c) => c.id === nieta.id);
    const bisnietaNode = nietaNode?.children.find((c) => c.id === bisnieta.id);
    expect(bisnietaNode).toBeDefined();

    const { items } = await listCategories({ rootsOnly: false, limit: 1000 });
    const bisnietaFlat = items.find((n) => n.id === bisnieta.id);
    expect(bisnietaFlat?.parent?.parent?.parent?.id).toBe(raiz.id);

    await deleteCategory(bisnieta.id);
    await deleteCategory(nieta.id);
    await deleteCategory(hija.id);
    await deleteCategory(raiz.id);
  });
});

describe('cierre de la suite (R28-2)', () => {
  it('ningún test de escritura dejó basura: prisma.category.count() vuelve a 198', async () => {
    expect(await prisma.category.count()).toBe(198);
  });
});
