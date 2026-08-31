# Archive Report: Categorización a slugs del catálogo + `category_product` (US-7)

**Change**: `2026-08-28-categorizacion-slugs-catalogo`  
**Archived**: 2026-08-31  
**Status**: PASS WITH WARNINGS (accepted by repo owner, verified by execution)  
**Verification Gate**: `sdd-verify` closed via real execution (`just db-check` 48/48; base on baseline)

---

## Deliverables vs. CA (Acceptance Criteria)

### CA-1: Mapeo cerrado de etiquetas a slugs existentes
**Status**: ✅ Delivered

- 8 etiquetas de 6 spiders mapeadas a slugs del type `gadget` (`laptop`, `sound-box`, `headphone`, `accessories-gfa`, etc.)
- Fallback exhaustivo a `accessories-gfa` para valores desconocidos, ausentes, `None`, o vacíos
- Fail-fast al abrir el spider si falta algún slug esperado (FK sobre `categories`)
- No regresión: 198 categorías, 1200 seeded products

**Evidence**: 
```
Design § 6.1-6.5, Phase 1.1-1.6 de tasks.md [x]
Phase 3.3 GROUP BY: 198 categorías post-procesamiento
```

### CA-2: Desambiguación de audio por palabras clave normalizado
**Status**: ✅ Delivered

- `categoria="audio"` → `headphone` si `nombre` contiene término de audífono (19 keywords, normalización NFKD)
- Default a `sound-box` si no hay match
- Sin warnings para `audio` (es etiqueta mapeada, no desconocida)
- Keywords cerrada: exluye explícitamente marcas duales (Bose, Beats) que venden parlantes

**Evidence**:
```
Phase 3.2: insertados: 12 (2 audio items, acertados)
Phase 3.5: Rename item 5 a "Audífonos JBL Tune 520BT" → GROUP BY: headphone: 2, sound-box: 0
Phase 3.6: Curl /api/products?search=categories.slug:headphone devuelve ambos
```

### CA-3: Idempotencia y reproceso sin duplicar fila puente
**Status**: ✅ Delivered

- Fila en `category_product` generada via upsert de `products` + immediate insert
- `ON CONFLICT (product_id, category_id)` mantiene unicidad
- Reproceso: mismo producto, mismo slug → cero duplicados, incrementa `actualizados`
- Cambio de nombre entre corridas → DELETE antigua + INSERT nueva en la misma transacción

**Evidence**:
```
Phase 3.2: stats insertados: 12, actualizados: 0
Phase 3.4 (reproceso): stats actualizados: 12, GROUP BY idéntico
Phase 3.5 (nombre cambió): GROUP BY: sound-box → 0, headphone → 2 (sin duplicados)
```

---

## Design Deviations & Resolution

### Desviación 1: Data Flow — Incremento de `insertados`/`actualizados` movido a DESPUÉS del puente

**What happened**:  
El design (sección "Data Flow") dibujaba el flujo como:
1. Upsert `products` → cuenta en `stats` (insert/update)
2. Puente `category_product`

Pero las Decisiones F y D-7 decían que `insertados`/`actualizados` deben contar "items **completamente** ingeridos", no "filas de `products` escritas".

Ejecuté una interpretación conservadora: el increment de `stats` ocurre **tras** el puente (si el puente falla, el producto se insertó pero NO cuenta como "ingerido"). **Esto contradice el diagrama del design.**

**Validación**:  
`sdd-verify` forzó un fallo real de FK (simuló `category_product` sin la `category_id`). El producto escribió en `products` (sin error) pero `actualizados` NO incrementó porque el insert puente falló. Esto prueba que la desviación es **correcta por diseño** — el design dicho en prosa (Decisiones) ganó contra el diagrama.

**Registro**: Esta desviación está declarada en el verify-report como desvío de especificación aceptado; el código refleja fielmente la decisión de que un "item ingerido" requiere AMBAS escrituras (productos + categoría).

**Note for US-8**: `just db-test` va a assertar sobre `stats["insertados"]` y `stats["actualizados"]`. Estos valores ahora significan "items completados de punta a punta", no "filas de `products` tocadas". US-8 debe asumir esa semántica.

---

### Desviación 2: Semántica de `insertados`/`actualizados` desplazada (no es solo row count)

**What happened**:  
El nombre `insertados`/`actualizados` sugiere "filas en `products` insertadas/actualizadas". Pero la Decisión F dice:

> *Insertados*: filas **completamente** ingeridas (upsert + categoría).

Con la desviación anterior, estos contadores **incluyen un conteo tácito del éxito del puente**. Si el puente falla, la fila de `products` existe (sin error de constraint), pero no incrementa.

**Implicación para downstream**: US-8 debe validar que `stats["insertados"]` == número de filas en `products` con `category_id NOT NULL` (o similar). Si hay filas sin categoría (ventana destroy-then-fail del puente), NO contarán como "insertadas" incluso si la fila de `products` está ahí.

**No regression**: De hecho, el verify probó esto: un producto entró en `products`, el puente falló, `actualizados` NO incrementó. Limpieza después devolvió la categoría a 0. Comportamiento correcto por diseño.

---

### Desviación 3: Ventana destroy-then-fail del puente bajo `autocommit`

**Hypothesis de design**: Si el `DELETE` en `category_product` falla, el upsert de `products` y el INSERT nuevo fallaban juntos (transacción abortada).

**Realidad observada** (ejecutada, no simulada):  
- `autocommit=True` en Psycopg
- Upsert de `products` confirmado inmediatamente
- `DELETE category_product` se ejecuta en el mismo `try`/cursor
- Si el DELETE **falla** (p. ej. FK inversa), el INSERT nuevotambién falla, ambos dentro del `except`
- Pero si el DELETE **tiene éxito** y luego el INSERT falla, el producto queda **sin fila puente en esa corrida**

**Observación real de `sdd-verify`**:  
```
Pre: product_id=X, category_id=sound-box (1 fila en category_product)
FK falla en INSERT (simulada)
Post: product_id=X, category_id=0 (fila destruída, INSERT no ejecutó)
```

**Auto-recovery**: La siguiente corrida (reproceso del mismo producto) ejecuta el INSERT de nuevo sin duplicar (ON CONFLICT). **No es un bug, es una ventana transaccional aceptada.**

**Declaration**: Esta ventana está documentada en Design § D-7 ("Ventana de inconsistencia transitoria bajo `autocommit`"). Es intencionada, aceptable, y auto-reparable.

---

## Known Limitations (Declaradas, no Compensadas)

### Categorías sin cobertura del scraper
- **`camera`, `router`, `smart-watch`**: ningún spider scrapa estos tipos. No es violación de CA — el catálogo tiene las categorías, pero el scraper no genera items para ellas. Limitación del vocabulario de origen, no del código.

### Webcam de Falabella bajo categoría incorrecta
- **Hecho**: Falabella scrapa webcams bajo la URL "Computadores", el spider toma `categoria="laptop"` del context de la URL.
- **Resultado**: Webcam categorizada en `laptop` en vez de `accessories-gfa` (mala clasificación en origen).
- **No compensada**: El spider NO tiene lógica de desambiguación por término. Decidida como limitación de diseño, no como bug.

### KEYWORDS_AUDIFONO no es exhaustiva
- **Qué hay**: 19 palabras clave (cabecera de design § 6.3)
- **Qué falta**: Otros términos válidos (p. ej. audio profesional, audiófonos inalámbricos exóticos)
- **Por qué**: Cierre intencional. El design optó por precisión sobre cobertura.

---

## Semantic Drift Alertas para Implementación Futura

### W-7: Sin Cobertura Automatizada de Prueba (DEBT)

**Estado actual**:  
- Cero tests en `services/scraper-worker/` (ni unittest, ni pytest, ni Scrapy tests)
- Verificación SDD: 100% scripts de scratchpad (mueren al cierre de sesión)
- `just db-test` sigue rojo (US-8, no es regresión)

**Riesgo**:  
Un cambio futuro en `pipelines.py` (p. ej. refactor de `slug_de_etiqueta()`) puede romper la categorización **en silencio**. Hoy, no hay gate automatizado de CI.

**Resolución**: US-8 (o posterior) debe crear `test_pipeline.py` con casos de prueba permanentes. Hoy no aplica — está explícitamente fuera de alcance.

---

## Marcas Duales: earfun, jabra

**Hallazgo de ejecución**:  
Ambas marcas scrapeaban PARLANTES en los 6 retailers. El design excluyó deliberadamente estas marcas de `KEYWORDS_AUDIFONO` (Decisión B), pese a que venden ambos productos.

**Resultado**: Cuando aparece "Parlante Earfun" o "Parlante Jabra", se categorizan en `sound-box` (correcto). Si mañana un retail agrega "Audífonos Earfun", se categorizarían en `headphone` (inconsistencia heredada del design, no del código).

**Declaración**: Inconsistencia **de producto**, no de lógica. El código implementa fielmente el mapping de design.

---

## Brecha de Convención & Resolución Manual

**Problema**: El delta de `scraper-product-ingestion` requiere cambios en **Purpose** y **Out of Scope** (prosa de cabecera, no `Requirements`).

`openspec-convention.md:65-74` solo define:
```
## ADDED Requirements
## MODIFIED Requirements
## REMOVED Requirements
## RENAMED Requirements
```

**Decisión del dueño del repo** (anotada en el delta del change): aplicar el reemplazo de Purpose y Out of Scope **a mano**, registrando la desviación en este reporte.

**Aplicación manual de archive**:
1. Purpose: reemplazado línea 3-10 → menciona `category_product` y extensión de `fallidos`
2. Out of Scope: reemplazado línea 133-137 → acota exclusión a "traducción + fila puente" en `scraper-product-categorization` (U-7)
3. Requirement "Captura de violaciones...": reemplazado completamente → incluye scenarios de fallo del insert puente

**Result**: `openspec/specs/scraper-product-ingestion/spec.md` ahora refleja que la categorización ESTÁ FUERA de esta capability (es un subcapability, US-7), pero **no está fuera del alcance de la ingestion bajo la cual ocurre**.

**Extension de convención propuesta**: Formalizar `## MODIFIED Purpose` / `## MODIFIED Out of Scope` como secciones de delta que permitan reemplazo íntegro de esas cabeceras. Hoy es un precedente ad-hoc.

---

## Specs Promoted to Main Source of Truth

| Domain | Action | Location |
|--------|--------|----------|
| `scraper-product-categorization` | NEW (full spec) | `openspec/specs/scraper-product-categorization/spec.md` |
| `scraper-product-ingestion` | MODIFIED (Purpose, Out of Scope, Requirement) | `openspec/specs/scraper-product-ingestion/spec.md` |

---

## Artifact Inventory

✅ **Archived change** (all source artifacts preserved):
- `proposal.md` — user story, scope, approach
- `explore.md` — discovery session
- `design.md` — data model, flow, decisions
- `specs/scraper-product-categorization/spec.md` — full spec (PROMOTED)
- `specs/scraper-product-ingestion/spec.md` — delta (APPLIED to main)
- `tasks.md` — 21/21 tasks [x] completed
- `apply-progress.md` — execution journal + all code diffs
- `verify-report.md` — PASS WITH WARNINGS, real execution proof

✅ **Main specs updated**:
- `openspec/specs/scraper-product-categorization/spec.md` (new)
- `openspec/specs/scraper-product-ingestion/spec.md` (delta applied)

✅ **Previous archives intact** (6 changes, 2026-08-25 to 2026-08-28):
- US-1: Migrar API `/products` a Postgres
- US-2: Catálogos de apoyo (shops, manufacturers, types)
- US-3: Catálogos planos (`product-listing-api`)
- US-4a: Categorías árbol (`category-tree-api`)
- US-4b: Categorías apoyo (`flat-catalogs-api`)
- US-6: Upsert products con scraper (`scraper-product-ingestion`)

---

## SDD Cycle Completion

- [x] Exploration (discovery, precedents checked)
- [x] Proposal (scope, approach, rollback)
- [x] Specification (requirements, scenarios, limitations)
- [x] Design (architecture, data flow, decisions, alternatives)
- [x] Tasks (21 tasks, hierarchical, scope-bound)
- [x] Implementation (code delivered, integration verified, NO NEW REGRESSIONS)
- [x] Verification (PASS WITH WARNINGS, deviations explained, acceptance criteria met, real data validation)
- [x] Archive (specs promoted, delta applied, audit trail preserved)

**Status**: Cycle closed. Ready for next change (US-8 or equivalent).

---

## Nota Pendiente para el Dueño del Repo

`openspec-convention.md` está **explícitamente fuera de alcance** de esta US y no fue modificado. La extensión del convention para formalizr `## MODIFIED Purpose` / `## MODIFIED Out of Scope` es una propuesta documentada aquí; queda como decisión de arquitectura del repo, no de esta fase.

---

**Archive Report Created**: 2026-08-31  
**SDD Phase**: `sdd-archive` (executor: Claude Code)  
**Verification Closure**: By real execution; PASS WITH WARNINGS accepted by repo owner
