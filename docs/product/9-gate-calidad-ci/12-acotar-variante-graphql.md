# US-12 — Decidir y acotar la variante GraphQL

> `apps/api/graphql` y `apps/admin/graphql` (y el modo `dev:gql` del shop)
> existen completos pero nadie los opera ni documenta: decidir su destino y
> dejarlo escrito y aplicado, para que estudiantes y agentes no gasten tiempo
> en una rama muerta.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~100 (mayormente docs/justfile; 0 LOC de aplicación si la decisión es "congelar")

## Historia
**Como** estudiante que clona el monorepo, **quiero** saber sin ambigüedad qué
variante (REST/GraphQL) es la operativa y qué estado tiene la otra, **para**
no perder una tarde intentando levantar un stack que el repo no soporta.

## Contexto verificado

- El stack documentado y operado es REST (`apps/README.md`: "no es necesaria
  para el stack REST"). Ninguna receta del justfile arranca ni construye la
  variante GraphQL.
- Sin embargo: `apps/admin/graphql` se instala siempre (workspace `admin/*`),
  el shop conserva `dev:gql`/`build:gql` (requieren codegen con
  `graphql-let`), y `apps/api/graphql` tiene su propio package.json fuera de
  toda receta.
- Costo actual: tiempo de instalación del workspace, superficie de confusión,
  y divergencia creciente (la migración a Postgres del Épico 1 solo toca
  `api/rest`).

## Scope
**Incluye:** (1) registrar la decisión del dueño — congelar como referencia /
mantener operativa / eliminar — con sus razones, en `apps/README.md`; (2)
aplicar lo decidido en la capa de orquestación: notas en README + justfile
coherente (si se congela: dejar explícito que ningún target la cubre; si se
mantiene: agregar recetas `*-gql` funcionando; si se elimina: US separada de
borrado, NO borrar en esta).
**NO incluye:** borrar código (si la decisión es eliminar, se abre una US
propia con su plan de remoción), migrar la variante GraphQL a Postgres,
tocar el workspace de yarn salvo que la decisión lo exija y quepa en la sesión.

## Criterios de aceptación

### CA-1 — Decisión registrada por el dueño
La decisión (congelar/mantener/eliminar) está escrita en `apps/README.md` con
fecha y razones. **Esta US no arranca sin esa decisión: si el agente no la
tiene, pregunta y espera.**

### CA-2 — Orquestación coherente con la decisión
El justfile y los README no contradicen la decisión (p. ej. si se congela, no
queda ninguna instrucción que sugiera que `dev:gql` es un camino soportado sin
avisar su estado).

### CA-3 — El stack REST no se ve afectado
`just verify` pasa igual que antes de la US.

## Escenarios Gherkin
```gherkin
Feature: Variante GraphQL acotada
  Scenario: CA-1 — decisión primero
    Given que el dueño no ha registrado la decisión
    When un agente toma esta US
    Then el agente pregunta la decisión y no modifica nada hasta tenerla
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/README.md` | sección de decisión + estado de la variante GraphQL |
| `justfile` | solo si la decisión exige recetas nuevas o comentarios de estado |

## Definición de Done
- [ ] Decisión del dueño citada textual en el reporte.
- [ ] Diff de docs/justfile pegado.
- [ ] Salida real de `just verify` en verde.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Esta es una US de gobernanza: el valor está en eliminar ambigüedad, no en
  escribir código. Resistir la tentación de "aprovechar y borrar".
