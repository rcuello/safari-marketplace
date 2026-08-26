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
| Mezclar 2 US en 1 sesión | 1 US = 1 sesión de agente |

---

## Mapa del backlog (orden recomendado)

```
Épico 1  Catálogo servido desde Postgres      → US-2, US-3, US-4a, US-4b
Épico 5  Scraper al catálogo compartido       → US-6, US-7, US-8
Épico 9  Gate de calidad y CI                 → US-10, US-11, US-12
Épico 13 Orquestación local con Docker        → US-14, US-15
Épico 16 Despliegue y observabilidad          → US-17, US-18   ← Terraform: el README lo promete, hoy no existe
```

**US recomendada para arrancar: US-6** (el pipeline del scraper escribe hoy en
una tabla que ya no existe — es el único componente roto del repo). En paralelo
puede ir **US-2** (continúa la migración a Postgres que `/api/settings` ya probó):
no comparten archivos.
