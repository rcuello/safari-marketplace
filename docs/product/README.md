# docs/product/ — Guía operativa

> Cómo abordar épicos y user stories en safari-marketplace. Denso para agentes,
> legible para humanos. Adaptado del patrón de signal-trader-bot.

---

## Qué vive acá

- **Épicos** (decisiones tomadas, ejecutables, descompuestas en sub-US).
- **User Stories standalone** (decisiones tomadas, no requieren épico).

## Qué NO vive acá

| Tipo | Ubicación |
|------|-----------|
| Guía de arranque local (stack REST) | `apps/README.md` |
| Modelo de datos del catálogo compartido | `db/README.md` + `db/schema.sql` |
| Capa de datos Prisma | `packages/db/README.md` |
| Documentación del scraper | `services/scraper-worker/README.md` |
| Ideas sin decisión/orden aún | `docs/product/_backlog/` |

Si todavía se está explorando, **NO** es producto. Es research hasta que haya
decisión de "se hace".

---

## Estructura

```
docs/product/
├── README.md                  ← este archivo
├── _backlog/                  ← ideas sin decisión/orden aún
├── {NN}-{slug}/               ← épico (carpeta)
│   ├── README.md              ← el épico
│   └── {NN}-{slug}.md         ← sub-US
└── {NN}-{slug}.md             ← US standalone (archivo plano)
```

**Regla:** carpeta = épico. Archivo plano = US standalone.

---

## Numeración

| Regla | Detalle |
|-------|---------|
| Secuencia global | Próximo número = `max(docs/product, docs/product/*) + 1`. |
| Sub-historias | Continúan la secuencia global, **sin decimales** (épico 1 → sub-US 2, 3, 4). |
| Padding | Sin padding (`3-…`, no `03-…`). |
| Slug | `kebab-case`, ≤6 palabras, sin acentos. Ej: `2-migrar-api-products-postgres.md`. |

---

## Épico vs US standalone

US standalone = **una** historia ejecutable (~150-400 LOC, una sesión de agente).
Es **épico** si cumple ≥2 de:

| # | Criterio | Umbral |
|---|----------|--------|
| 1 | Tamaño total | >500 LOC estimadas |
| 2 | Más de 1 fase natural | módulos con riesgo/verificación distinta |
| 3 | Releases incrementales | hay valor entregable por etapas |
| 4 | Superficies distintas | capa de datos vs API vs frontend vs scraper vs infra |

0-1 criterios → US standalone (archivo plano). ≥2 → épico (carpeta con sub-US).

---

## Flujo de ejecución (agentes)

Cada US la ejecuta **un agente en una sesión**. Protocolo obligatorio:

1. **Leer antes de tocar código**: la US completa, el README de su épico, el
   `CLAUDE.md` de la raíz y el README del área tocada (`apps/README.md`,
   `db/README.md`, `packages/db/README.md` o el del scraper).
2. **Respetar el Scope**: lo que dice "NO incluye" no se implementa, aunque parezca
   fácil. Mejoras adyacentes se mencionan en el reporte final, no se accionan.
3. **Fuente de verdad del esquema**: el DDL vive en `db/schema.sql` (aplicado por
   `just db-migrate`). `packages/db/prisma/schema.prisma` se regenera por
   introspección (`prisma db pull` + renombres), nunca genera migraciones. Las
   CHECK constraints que Prisma no modela se validan en los repositorios.
4. **Contratos HTTP preservados**: al migrar un endpoint del mock JSON a Postgres,
   la respuesta se preserva byte a byte (precedente verificado: `/api/settings`,
   5503 bytes idénticos antes y después). La API publica snake_case; la capa de
   datos devuelve camelCase; la traducción vive en los servicios de Nest.
5. **Verificar la Definición de Done con comandos reales** (`just db-check`,
   `just db-test`, `just verify`, `curl` contra endpoints, builds) y
   pegar la evidencia en el reporte. "Debería funcionar" no cierra una US.
   La DoD incluye el **lint sin escribir en 0** en los paquetes tocados:
   `cd packages/db && npm run lint`, `cd apps/api/rest && npx eslint
   "{src,apps,libs,test}/**/*.ts"` (nunca `yarn lint`: lleva `--fix` y
   reescribe archivos) y `cd apps/shop && yarn lint`. El hook PostToolUse
   `.claude/hooks/post-tool-use/format-edited-file.cjs` formatea cada archivo
   al editarlo (biome en `packages/db`, prettier en la API, el shop y el
   admin), pero la DoD lo verifica igual.
6. **Actualizar el Status** de la US al terminar (`Implementada`) y marcar la fila
   correspondiente en la tabla del épico.
7. **1 US = 1 sesión.** No mezclar dos US aunque sean del mismo épico. Si la US
   resulta ambigua o contradice la arquitectura del monorepo, se detiene y pregunta.

**Orden de ejecución:** respetar `Depende de:`. US sin dependencia mutua pueden ir
en paralelo (agentes distintos), pero nunca dos agentes sobre archivos compartidos.

---

## Plantilla — US (standalone o sub-historia)

```markdown
# US-{NN} — {Título}

> {1-2 líneas}.

**Épico:** [Épico {N}](./README.md)   ← solo si es sub-historia
**Fecha:** {YYYY-MM-DD}
**Status:** {Listo para ejecución | En ejecución | Implementada | Archivada}
**Depende de:** {US-NN | ninguna}
**LOC est.:** ~{N}

## Historia
**Como** … **quiero** … **para** …

## Scope
**Incluye:** … **NO incluye:** …

## Criterios de aceptación
### CA-1 — {título}
### CA-2 — {título}

## Escenarios Gherkin
```gherkin
Feature: …
  Scenario: CA-1 — …
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|

## Definición de Done
- [ ] …
- [ ] Lint sin escribir en 0 en los paquetes tocados, con la salida pegada
      (`npm run lint` en `packages/db`, `npx eslint "{src,apps,libs,test}/**/*.ts"`
      en la API, `yarn lint` en el shop)

## Notas para el agente ejecutor
- …
```

## Plantilla — Épico (`README.md`)

```markdown
# Épico {N} — {Título}

> {1-2 líneas}.

**Fecha:** {YYYY-MM-DD}
**Status:** {Refinado | En ejecución | Completado}

## Subdivisión en sub-historias
| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|

## Refinamiento — Decisiones tomadas
| # | Tema | Decisión |
|---|------|----------|

## Visión técnica compartida
### Decisiones de Diseño (D-N)
### Riesgos (R-N)

## Notas globales para los agentes
```

---

## Cross-references

| Origen → Destino | Patrón |
|------------------|--------|
| Sub-US → épico | `[Épico {N}](./README.md)` |
| Épico → sub-US | `[US-{NN}](./{NN}-{slug}.md)` |
| Cualquiera → código | path desde la raíz del repo (`apps/api/rest/src/...`, `packages/db/src/...`, `db/schema.sql`) |
| Cualquiera → guía de arranque | `apps/README.md#{sección}` |

---

## Antipatrones

| ❌ | ✅ |
|----|----|
| Sub-US con decimales (`1.1-…`) | Secuencia global (`2-…`) |
| Implementación detallada en la US | US = CAs (qué); el agente decide el cómo dentro de la arquitectura |
| Cambiar el contrato HTTP al migrar un endpoint | Respuesta byte a byte idéntica; snake_case hacia afuera |
| Editar `schema.prisma` a mano para cambiar el modelo | Cambiar `db/schema.sql` y re-introspeccionar |
| El scraper con tablas/esquema propios | Escribe en `products` con `source_store`/`source_product_id` |
| Reportar "implementado" sin evidencia | DoD verificado con comandos y salida pegada |
| Dejar el formateador y el lint "para después" | El hook formatea al editar; la DoD verifica el lint sin escribir en 0 (en la API nunca `yarn lint`: lleva `--fix`) |
| Mezclar 2 US en 1 sesión | 1 US = 1 sesión de agente |

---

## Mapa del backlog (orden recomendado)

```
Épico 1  Catálogo servido desde Postgres      → US-2, US-3, US-4a, US-4b, US-5   (completado)
Épico 5  Scraper al catálogo compartido       → US-6, US-7, US-8   ← US-6/7 hechas; queda US-8 (`just db-count` aún consulta `productos`)
Épico 9  Gate de calidad y CI                 → US-10, US-11, US-12, US-73, US-74   ← US-10/11 actualizadas tras el escaneo de bingo-flow (2026-10-24); US-73 audit en modo reporte; US-74 tras US-10
Épico 13 Orquestación local con Docker        → US-14, US-15
Épico 16 Despliegue y observabilidad          → US-17, US-18   ← Terraform: el README lo promete, hoy no existe
Épico 19 Autenticación y autorización         → US-20 … US-25  (completado)
Épico 26 Escrituras del catálogo desde Postgres → US-27a … US-30  (completado 2026-09-11)
Épico 33 Contenido y configuración desde Postgres → REEMPLAZADO por el Épico 46 (2026-10-20)
Épico 40 Identidad extendida desde Postgres      → US-41 ✅, US-42, US-44 ✅   ← US-43 reemplazada por US-63 del Épico 46
Épico 46 API sin mocks JSON (19 controladores)   → US-47 … US-63 ✅ (completado 2026-10-23) ← SECUENCIAL; cada US trae su DDL + seed + db-reset; levanta la exclusión de db/schema.sql:13-16
Épico 75 Actualización de dependencias          → US-76 ✅, US-77 ✅, US-78 … US-87 (refinado 2026-10-24) ← una mayor por US; API (77→79) y frontend (80→83) en paralelo; DA-1..DA-6 con propuesta por defecto
US-31    Guardas de id fuera del rango bigint   → standalone   ← implementada: cubrió `types`/`tags`/`manufacturers`, `users` y las 2 FK de `packages/db`
US-32    Deriva de reloj `updated_at`/`created_at` → standalone ← PRERREQUISITO de US-34: su elección de reloj es insumo del DDL del Épico 33 (R-3, resuelto 2026-09-14)
US-64    `messages/seen` y estado de lectura      → standalone ✅ (2026-10-23) ← después de US-56; comparte archivos con el Épico 46, NO en paralelo con sus US
US-65    `abusive_reports/reject` (rechazar)      → standalone ✅ (2026-10-23) ← después de US-55; decisiones DD-1..DD-3 con propuesta por defecto
US-66    El staff responde preguntas              → standalone ✅ (2026-10-23) ← después de US-55; «staff» = fila en shop_staff (Decisión 1)
US-67    Mensaje del 409 por clave única          → standalone ✅ (2026-10-23) ← opción (c): mismo code, el mensaje nombra el campo
US-68    Cupones del seed vigentes                → standalone ✅ (2026-10-23) ← opción (b) +5 años, decidida por el dueño; se aparta de la decisión 6 solo en las fechas
US-69    Índices trigram que el ILIKE no usa      → standalone ✅ (2026-10-23) ← opción (a): trigram sobre la columna + VACUUM ANALYZE en db-migrate
US-70    Login con Google opcional en el shop     → standalone ✅ (2026-10-24) ← DA-1..DA-3 (a); sin variables no hay proveedor ni botón; el stub D-11 de social-login-token sigue
US-71    El shop no expulsa por un 401/403        → standalone ✅ (2026-10-24) ← interceptor solo 401 con token; tienda y avisos solo en /shops/[slug]; R-6 intacto
US-72    Higiene agéntica (hooks .env y node_modules) → standalone ✅ (2026-10-24) ← DA-1..DA-4 (a); hooks PreToolUse activos en .claude/settings.json; .editorconfig sin end_of_line
```

Las US-64 a US-69 salen de los «NO incluye» y hallazgos del Épico 46 (US-52
a US-56). Todas tocan archivos compartidos con ese épico (`db/schema.sql`,
`schema.prisma`, `records.ts`, el barrel o el generador), así que **ninguna va
en paralelo con una US del Épico 46 ni con otra de ellas**.

**Actualización 2026-10-20 — lo que queda con JSON es el
[Épico 46](./46-api-sin-mocks-json/README.md).** El dueño decidió migrar en
un solo épico los 19 controladores que aún leen JSON (120 rutas). Las
consecuencias:

- se absorben el Épico 33 y la Fase 3;
- se levanta la exclusión de `db/schema.sql:13-16`;
- cada US trae su propio DDL, su seed y su `db-reset`, autorizado para las 17
  US;
- los 4 mocks permanentes se mantienen.

**US recomendada para arrancar: US-47.** Las US del Épico 46 van **en orden
estricto** (comparten `schema.sql`, el generador, `schema.prisma`,
`records.ts` y el barrel). US-42 (Épico 40) puede ir antes o después, pero
nunca en paralelo con una del 46. Los párrafos de abajo, sobre el Épico 33,
la Fase 3 y US-34, son el **registro histórico** de antes de esa decisión.

Lo que sigue mock está inventariado con evidencia en
[`_backlog/api-mock-restante-dominio-transaccional.md`](./_backlog/api-mock-restante-dominio-transaccional.md).
Su **Fase 1** ya es el [Épico 33](./33-contenido-configuracion-postgres/README.md)
y su **Fase 2** el [Épico 40](./40-identidad-extendida-postgres/README.md)
(promovida el 2026-09-15). La Fase 2 entrega solo `staffs` y `become-seller`:
`balance`/`withdraws` y `ownership-transfer` cuelgan de *wallets*, que la
exclusión nombra, y el dueño los **aplazó a la Fase 3 el 2026-09-15**
(opción C). Solo queda sin decisión la **Fase 3** (núcleo transaccional más
lo heredado), que exige levantar por escrito la exclusión de
`db/schema.sql:13-16` y que el dueño congeló hasta que cierre la Fase 1.
`payment-intent`, `payment-method`, `authors` y `flash-sale` quedaron como
**mock declarado permanente** (decisión del 2026-09-14).

**US standalone** (archivo plano, sin épico; ambas salieron de gates
adversariales de US-28, no de tests):

- [US-31](./31-guardas-id-fuera-de-rango-bigint.md) — guardas de id fuera del
  rango `bigint`. Era un **defecto vivo en `main`**, no una regresión.
  **Implementada** (~230 LOC reales, no ~120): cubrió `types`/`tags`/
  `manufacturers`, las 5 guardas de `users` y las 2 guardas de FK
  (`type_id`) de `packages/db`.
- [US-32](./32-deriva-reloj-updated-at-created-at.md) — deriva de reloj entre
  `created_at` y `updated_at`. **Toca DDL** y exige `just db-reset`, así que no
  puede ir dentro del Épico 26 (decisión 1 de ese épico).

**US recomendada para arrancar: US-34** (Épico 33). US-32 era su prerrequisito
duro —su elección de fuente de reloj es un **insumo del DDL**, porque las 8
tablas de entidad que crea US-34 reciben `PUT` reales y deben nacer bajo una
sola política— y **cerró el 2026-09-15** con la Opción B: no queda ningún
trigger y el reloj lo fija siempre el repositorio
(`openspec/specs/data-layer-clock-policy/spec.md`). Dependencia levantada.

El Épico 40 (Fase 2) puede ir **después** de US-34 o en paralelo por otro
agente, pero su US-41 necesita **autorización nueva de `just db-reset`**: la
del 2026-09-14 cubría solo US-32 y US-34 y no es heredable.

US-34 es después la habilitadora del Épico 33 y bloquea a las cinco
siguientes: lleva todo el DDL del épico en una pasada, con un único
`just db-reset`, siguiendo el precedente de los Épicos 19 y 26. Se la mantiene
deliberadamente fina (~1450 LOC: DDL, seed, `schema.prisma`, `records.ts`,
barrel); los repositorios y sus tests van en US-35..39.

Tras US-34, las US-35 a US-39 no dependen entre sí y admiten agentes en
paralelo; solo comparten el barrel `packages/db/index.ts`, así que quien
arranque segundo rebasea sobre él.

Antes de estimar cualquiera de ellas, leer el sesgo medido del Épico 26 en su
README: sus US cerradas desbordaron la estimación original entre ×2.0 y ×4.6.
Las cifras del Épico 33 ya parten de los reales del 26, no de una intuición
optimista — aun así, son suelo y no techo.

**Dos herencias que NO se copian a ciegas** (las midió el `sdd-verify` de
US-27b; su `archive-report.md` las detalla):

- **US-29** — el remedio de S-1 (omitir `uniqueField` al traducir el error de
  Prisma) es local a agregados con **un solo** unique. `products` tiene un
  segundo (`products_procedencia_key`, el parcial del scraper), así que
  copiarlo haría que una violación P2002 mienta diciendo `slug`. Y con 3 FK
  salientes, `products.desconocida` no es actuable: toca pre-validar cada FK en
  el repositorio del agregado.
- **US-30** — no hereda el "no hay 409" de US-27b: `shops.owner_id` es
  `RESTRICT` y `products.shop_id` es `CASCADE`, así que `deleteShop` necesita
  el patrón de borrado protegido de `types` (US-27a), no el de `tags`.

En paralelo puede ir **US-8** (lo único que queda del Épico 5: realinear
`db-test`/`db-count` con la tabla `products` — `justfile:308` todavía consulta
`productos`): no comparte archivos con el Épico 26. US-6 ya no es el arranque:
está implementada, igual que US-7.
