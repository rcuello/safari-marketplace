# Épico 1 — Catálogo servido desde Postgres

> Completar la migración de la API REST del mock JSON a la capa de datos
> `@safari/db`. `/api/settings` ya salió de Postgres (commit `41f4e7d`) y probó
> la fontanería completa; falta el catálogo, que es lo que el scraper alimenta
> y la tienda consulta.

**Fecha:** 2026-08-25
**Status:** En ejecución

## Contexto verificado

- `apps/api/rest` sirve JSON estático desde `src/db/pickbazar/` para todos los
  endpoints **excepto** `/api/settings`, que ya consulta Postgres vía
  `@safari/db` (`apps/api/rest/src/settings/settings.service.ts`).
- `packages/db` ya tiene repositorios para todos los agregados del catálogo
  (`products`, `categories`, `manufacturers`, `settings`, `shops`, `tags`,
  `types` en `packages/db/src/repositories/`), con un test de integración
  solo para products.
- La base local (`just db-up`) queda sembrada con los datos reales del mock
  (1200 productos, 12 shops, 198 categorías), así que la migración puede
  verificarse por comparación byte a byte contra el mock.
- `db/schema.sql` documenta que `category_product` queda vacía a propósito
  (el mock no trae la relación): buscar por categoría devuelve hoy cero
  resultados también en la app original.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. | Status |
|----|--------|-----------------|------------|----------|--------|
| [US-2](./2-migrar-api-products-postgres.md) | Migrar /api/products a la capa de datos | Sí | ninguna | ~300 | ✅ Implementada |
| [US-3](./3-detalle-producto-postgres.md) | Detalle de producto y relacionados desde Postgres | Sí | US-2 | ~200 | Listo para ejecución |
| [US-4](./4-migrar-catalogos-apoyo.md) | Migrar catálogos de apoyo (types, categories, tags, manufacturers, shops) | Sí | US-2 | ~350 | Listo para ejecución |

**Orden sugerido:** US-2 → (US-3 ∥ US-4). US-3 y US-4 no comparten archivos de
servicio, pero ambas tocan módulos de Nest distintos; verificar antes de
paralelizar.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Contrato HTTP | Se preserva byte a byte donde el dato lo permita; como mínimo, mismas claves snake_case, mismos tipos y mismo shape de paginación. El precedente `/api/settings` (5503 bytes idénticos) es el patrón. |
| 2 | Traducción de casing | camelCase (Prisma) → snake_case (API) en el servicio de Nest, igual que en settings. |
| 3 | Endpoints no-catálogo | Órdenes, usuarios, carritos, reviews y pagos quedan en el mock: `db/schema.sql` los excluye a propósito. |
| 4 | Búsqueda | La búsqueda por nombre usa el índice trigram ya creado (`products_nombre_trgm_idx`); no se introduce motor de búsqueda nuevo. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)
- **D-1:** Los servicios de Nest consumen los repositorios de `@safari/db`;
  la API no importa `@prisma/client` directo.
- **D-2:** Las violaciones de CHECK constraints llegan como errores de dominio
  desde los repositorios; el servicio los traduce a HTTP (400/404), nunca a 500.

### Riesgos (R-N)
- **R-1:** El shape de paginación del mock (estilo Laravel: `data`, `total`,
  `current_page`, …) debe reproducirse exacto o la tienda rompe el scroll
  infinito. Verificar contra la respuesta real del mock antes de escribir código.
- **R-2:** `fuse.js` hace hoy la búsqueda difusa en memoria sobre el JSON; la
  búsqueda SQL `contains/insensitive` no rankea igual. Aceptado: el orden de
  resultados puede diferir, el contrato de shape no.

## Notas globales para los agentes

- Arrancar siempre con la base sembrada (`just db-up`) y la API compilando
  (`just db-build` si `packages/db/dist` no existe tras clonar).
- Evidencia mínima por endpoint migrado: `curl` antes (mock) y después
  (Postgres) con bytes/claves comparados, y la tienda renderizando
  (`just verify`).
