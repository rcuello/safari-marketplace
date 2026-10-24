# US-85 — react-query 3 → @tanstack/react-query 5 en el admin

> Repite en el admin la migración de US-84, siguiendo su patrón. El admin
> tiene casi el triple de llamadas, sobre todo mutaciones de los formularios
> de gestión.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-84
**LOC est.:** ~450

## Historia

**Como** mantenedor del admin, **quiero** el admin en TanStack Query 5,
**para** quitar `react-query` del workspace.

## Contexto — verificado (2026-10-24)

- 38 archivos de `apps/admin/rest/src` importan de `'react-query'` (35 en
  `src/data/`, 2 en `src/components/` y 1 en `src/pages/`), con 119
  llamadas a `useQuery(`, `useInfiniteQuery(` o `useMutation(`.
- Las mutaciones del admin crean, editan y borran productos, tiendas,
  cupones, categorías, etc. Casi todas invalidan una lista y muestran un
  toast.

## Scope

**Incluye:** lo mismo que US-84, aplicado a `apps/admin/rest/src`, y quitar
`react-query` del workspace.

**NO incluye:** admin/graphql (DA-4 del épico), ni cambiar la estrategia de
caché.

## Criterios de aceptación

### CA-1 — Sin la librería vieja

`grep -r "from 'react-query'" apps/admin/rest/src apps/shop/src` da 0, y
`react-query` ya no está en ningún `package.json` de las apps REST.

### CA-2 — CRUD de punta a punta

En el admin, con el usuario `super_admin` del seed, hay que probar cuatro
operaciones: crear, editar y borrar un producto, y editar un cupón. Cada
operación tiene que aparecer en su lista sin recargar. Los datos de prueba
se borran después.

### CA-3 — Humo sin avisos nuevos

Las rutas de humo del admin funcionan y la consola no muestra avisos nuevos.

## Escenarios Gherkin

```gherkin
Feature: Admin en TanStack Query 5
  Scenario: CA-2 — una mutación refresca su lista
    Given el admin migrado
    When el super_admin edita un producto
    Then la lista muestra el cambio sin recargar la página
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/admin/rest/package.json`, `apps/yarn.lock` | dependencia |
| `apps/admin/rest/src/data/**` y donde se importe | hooks y proveedor |

## Definición de Done

- [ ] Línea base (consola de las rutas de humo del admin).
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] `yarn lint` del admin sin hallazgos nuevos.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Reutiliza las decisiones que US-84 anotó. Si alguna no aplica al admin,
  justifícalo.
- Si los 38 archivos no caben en una sesión, se para en un punto estable y
  se pregunta si partir la US (por ejemplo, catálogo por un lado y pedidos y
  usuarios por otro).
