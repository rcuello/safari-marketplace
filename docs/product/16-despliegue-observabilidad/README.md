# Épico 16 — Despliegue y observabilidad

> El README raíz promete "despliegue automatizado con Terraform, Docker y
> Orm" — verificado 2026-08-25: **no existe un solo archivo `.tf` en el
> repo**, ni carpeta de infra, ni CD. Este épico convierte esa promesa en
> hechos mínimos: primero que los servicios sean observables (salud/logs),
> después la infra como código.

**Fecha:** 2026-08-25
**Status:** Refinado

## Contexto verificado (2026-08-25)

- `find . -name "*.tf"` → vacío. La única pieza de "despliegue" es
  `apps/deployment/` (scripts zx de Pickbazar para VM+Nginx, declarados como
  referencia en `apps/README.md`, no como camino).
- La API no expone ningún endpoint de salud propio (los healthchecks que US-15
  agregue en compose necesitan uno honesto; hoy lo más cercano es pegarle a
  `/api/settings`, que ya depende de Postgres).
- Logs actuales: consola de Nest/Next sin estructura ni timestamps
  configurados explícitamente.
- `apps/README.md` § "Notas para el despliegue en nube" ya documenta las
  restricciones reales: servicios stateless, `PORT` por entorno,
  `NEXT_PUBLIC_*` en build time, allowlist de `images.domains`,
  `APPLICATION_MODE=production` ignora errores de TS/ESLint.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| [US-17](./17-salud-logging-api.md) | Endpoint de salud y logging con timestamps en la API | Sí | ninguna | ~150 |
| [US-18](./18-terraform-minimo.md) | Terraform mínimo para el stack contenedorizado | Sí | US-15, US-17 | ~300 |

**Orden sugerido:** US-17 (barata, desbloquea healthchecks honestos) →
US-18 (requiere el stack dockerizado del Épico 13).

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Observabilidad antes que infra | No se aprovisiona nada que no se pueda saber si está vivo. US-17 precede a US-18. |
| 2 | Alcance didáctico | La infra es para enseñar: mínima, legible y destruible (`terraform destroy` sin residuos), no un setup productivo blindado. |
| 3 | Proveedor | **Decisión abierta del dueño** (Azure/AWS/GCP y qué servicio de contenedores). US-18 no arranca sin ella — está marcado como bloqueante en la US. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)
- **D-1:** El health de la API distingue "proceso vivo" (liveness) de "base
  alcanzable" (readiness): un healthcheck que miente es peor que ninguno.
- **D-2:** Terraform aprovisiona; las imágenes las construye el flujo del
  Épico 13/CI. No mezclar build de imágenes dentro de Terraform.

### Riesgos (R-N)
- **R-1:** Costos de nube en un repo didáctico: todo recurso lleva el tamaño
  mínimo y la US exige el `destroy` verificado como parte del DoD.
- **R-2:** Secretos (DATABASE_URL de nube): jamás versionados; el patrón de
  inyección se documenta en la US.

## Notas globales para los agentes

- El README raíz (2 líneas) menciona Terraform: cuando US-18 cierre, alinear
  esa mención con lo que de verdad existe; mientras tanto NO agregar promesas
  nuevas a ningún doc.
