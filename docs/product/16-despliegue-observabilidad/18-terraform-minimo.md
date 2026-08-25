# US-18 — Terraform mínimo para el stack contenedorizado

> Materializar la promesa del README: infra como código, mínima y didáctica,
> que aprovisiona lo necesario para correr el stack dockerizado (Épico 13) en
> el proveedor que el dueño elija, y se destruye limpia.

**Épico:** [Épico 16](./README.md)
**Fecha:** 2026-08-25
**Status:** Bloqueada por decisión de producto (proveedor de nube — ver CA-1)
**Depende de:** US-15, US-17
**LOC est.:** ~300

## Historia
**Como** profesor, **quiero** aprovisionar y destruir el entorno de
demostración con `terraform apply`/`destroy`, **para** enseñar
infraestructura como código con el mismo marketplace que los estudiantes ya
conocen, sin dejar recursos huérfanos facturando.

## Contexto

- Verificado 2026-08-25: cero archivos `.tf` en el repo; el README raíz
  promete Terraform desde el commit inicial.
- Insumos ya resueltos por otras US: imágenes de los 4 servicios (Épico 13),
  healthchecks honestos (US-17), restricciones de build documentadas
  (`NEXT_PUBLIC_*` en build time, `PORT` por entorno — `apps/README.md`).
- **Decisión abierta bloqueante (D-3 del épico):** proveedor y servicio de
  contenedores (p. ej. Azure Container Apps / AWS ECS / GCP Cloud Run) +
  Postgres gestionado vs contenedor. Sin esa decisión del dueño esta US no
  arranca.

## Scope
**Incluye:** carpeta `infra/` con Terraform para: registry de imágenes, el
servicio de contenedores para API/shop/admin, Postgres (según decisión),
inyección de secretos sin versionarlos (R-2 del épico), variables con
defaults mínimos, `README` de la carpeta con el flujo apply→smoke→destroy, y
la alineación de la mención de Terraform en el README raíz con lo que ya
existe.
**NO incluye:** CD automático (pipeline que haga apply), dominios/TLS
custom, alta disponibilidad, autoscaling afinado, ambientes múltiples
(un solo ambiente de demo), migrar el seed a un mecanismo de nube distinto
del ya definido en el Épico 13.

## Criterios de aceptación

### CA-1 — Decisión de proveedor registrada
El proveedor y los servicios elegidos están registrados por el dueño en el
README del épico (tabla de decisiones). **Sin esto, el agente pregunta y se
detiene.**

### CA-2 — `terraform apply` deja el stack sirviendo
Tras `apply` + push de imágenes, las URLs públicas responden: API
`/api/health/ready` 200, tienda con product cards, admin con login.

### CA-3 — Secretos fuera del repo
Ningún secreto (DATABASE_URL, credenciales) queda en archivos versionados;
`git grep` de los valores da vacío y el mecanismo usado queda documentado.

### CA-4 — `terraform destroy` limpio
`destroy` termina sin errores y el proveedor no muestra recursos residuales
del stack (evidencia: listado post-destroy).

## Escenarios Gherkin
```gherkin
Feature: Infra como código del marketplace
  Scenario: CA-2 — stack vivo tras apply
    Given terraform apply exitoso y las imágenes publicadas
    When pido el health readiness de la API pública
    Then responde 200 con la base gestionada alcanzable
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `infra/*.tf` | providers, registry, contenedores, base, variables, outputs |
| `infra/README.md` | flujo apply→smoke→destroy + costos aproximados |
| `README.md` (raíz) | alinear la mención de Terraform con la realidad (cambio mínimo) |

## Definición de Done
- [ ] Salida real (resumida) de `terraform apply` pegada.
- [ ] `curl` reales contra las URLs públicas (CA-2) pegados.
- [ ] Evidencia del CA-4 (destroy + listado vacío) pegada.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Recursos al tamaño mínimo del proveedor (R-1 del épico): esto es una demo
  didáctica, cada recurso de más es costo y ruido.
- Si el apply real no es posible en la sesión (sin credenciales del
  proveedor), la US NO se cierra: queda `En ejecución` con `terraform plan` y
  `validate` como evidencia parcial, y se dice explícitamente.
