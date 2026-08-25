# US-4 — Migrar catálogos de apoyo a la capa de datos

> `types`, `categories`, `tags`, `manufacturers` y `shops` dejan el mock JSON
> y pasan a Postgres, completando la migración del catálogo que el esquema
> compartido cubre.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** US-2
**LOC est.:** ~350

## Historia
**Como** estudiante, **quiero** que la navegación de la tienda (menú de types,
árbol de categorías, páginas de shops) salga de la base, **para** que los
shops y manufacturers que el scraper crea en tiempo de ejecución (los 6
retailers, las marcas tech) aparezcan en la tienda sin tocar ningún JSON.

## Contexto

- Los repositorios ya existen todos en `packages/db/src/repositories/`
  (`types`, `categories`, `manufacturers`, `shops`, `tags`), sin tests de
  integración propios.
- El seed preserva los ids del mock y reconstruye 3 shops que el mock
  referenciaba sin declarar (ver `db/README.md`), así que la comparación
  mock-vs-base tiene 3 filas extra conocidas y justificadas en `shops`.
- `categories` es un árbol (`parent_id` autoreferente) y el mock lo sirve
  anidado: la traducción árbol-SQL → shape-anidado es el riesgo principal.

## Scope
**Incluye:** los endpoints de listado (y detalle por slug donde la tienda lo
consuma) de types, categories, tags, manufacturers y shops.
**NO incluye:** authors (fuera del esquema del catálogo — queda en mock y se
dice en el design), endpoints de escritura del admin (create/update/delete
siguen en mock), `category_product` (vacía por diseño), cambios de frontend.

## Criterios de aceptación

### CA-1 — Paridad de contrato por catálogo
Cada endpoint migrado responde con las mismas claves snake_case y el mismo
shape (anidamiento incluido) que su versión mock, verificado con `curl` lado a
lado.

### CA-2 — El árbol de categorías se reconstruye completo
`GET` de categories devuelve las 198 categorías del seed con la misma
estructura padre-hijos que el mock.

### CA-3 — Los shops reconstruidos aparecen
El endpoint de shops devuelve las 12 filas del seed (9 del mock + 3
reconstruidos), y la diferencia con el mock queda documentada en el reporte.

### CA-4 — La tienda navega completa
`just verify` pasa y la navegación por un type y una categoría en la tienda
renderiza 200.

## Escenarios Gherkin
```gherkin
Feature: Catálogos de apoyo desde Postgres
  Scenario: CA-2 — árbol de categorías
    Given la base sembrada con just db-up
    When pido el listado de categorías del type "gadget"
    Then recibo las categorías con sus hijos anidados igual que el mock
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/types/*.service.ts` | consulta a `@safari/db` |
| `apps/api/rest/src/categories/*.service.ts` | ídem + reconstrucción del árbol |
| `apps/api/rest/src/tags/*.service.ts` | ídem |
| `apps/api/rest/src/manufacturers/*.service.ts` | ídem |
| `apps/api/rest/src/shops/*.service.ts` | ídem |
| `packages/db/src/repositories/*.repository.ts` | consultas faltantes |

## Definición de Done
- [ ] `curl` mock-vs-Postgres pegado para los 5 catálogos (al menos claves + conteos).
- [ ] Salida real de `just verify` en verde.
- [ ] Salida real de `just db-check` en verde.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Es la US más ancha del épico: si en el design supera con claridad una
  sesión, PARAR y proponer partirla (p. ej. categories aparte) antes de
  ejecutar a medias.
- Verificar por catálogo si la tienda pide paginado o lista plana: el mock no
  pagina igual en todos.
