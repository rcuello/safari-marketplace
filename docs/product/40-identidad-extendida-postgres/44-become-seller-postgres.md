# US-44 — `become-seller` desde Postgres

> Las 2 rutas de la página de «hazte vendedor» dejan de servir JSON estático y
> leen el singleton de US-41. Es la US más barata del épico: contenido de
> página, sin relaciones.

**Épico:** [Épico 40](./README.md)
**Fecha:** 2026-09-15
**Status:** Listo para ejecución (bloqueada por US-41)
**Depende de:** [US-41](./41-esquema-identidad-extendida.md)
**LOC est.:** ~500

## Historia
**Como** visitante del shop y como admin, **quiero** que la página de «hazte
vendedor» y su formulario salgan de la base, **para** que editarlos no exija
tocar un JSON del repo y desplegar.

## Contexto — verificado en código

- Solo **2 rutas** (`apps/api/rest/src/become-seller/become-seller.controller.ts`).
  Es el módulo más pequeño de los que quedan mock con consumidor.
- `apps/api/rest/src/db/pickbazar/become-seller.json` es **un solo objeto**
  con `page_options`: banner, `defaultCommissionRate`,
  `defaultCommissionDetails`, textos de la landing. Es **contenido de página**,
  no una entidad transaccional — por eso US-41 le da una tabla singleton y no
  una colección.
- **No va dentro de `settings`.** Aunque el inventario lo listaba como
  «candidato a fila en `settings`», la respuesta de `/api/settings` está
  congelada byte a byte (5503 B) y meter `page_options` ahí la haría crecer.
  US-41 crea una tabla propia con el mismo patrón (`id smallint PRIMARY KEY
  DEFAULT 1` + CHECK de fila única).
- Consumidores reales verificados en el shop:
  `components/become-seller/index.tsx`,
  `components/become-seller/templates/user-story/customer-stories.tsx`,
  y los dos headers (`layouts/header.tsx`, `layouts/header-minimal.tsx`).
  En el admin: `data/become-seller.ts` y su entrada de menú.

## Scope

**Incluye:** las 2 rutas leyendo y escribiendo el singleton de US-41; el
repositorio de funciones planas y sus tests; la traducción
camelCase→snake_case en el servicio de Nest; tests de Nest con `@safari/db`
mockeado.

**NO incluye:** cambiar el contrato HTTP; rediseñar el contenido de la página;
`staffs`, `ownership-transfer` ni `withdraws`; tocar `settings`; frontend.

## Criterios de aceptación

### CA-1 — Lectura desde Postgres, contrato intacto
`GET` devuelve exactamente el mismo JSON que hoy sirve
`become-seller.json`, con el mismo tamaño en bytes. La comparación se hace
con evidencia, no a ojo.

### CA-2 — Escritura real
La ruta de escritura actualiza el singleton y el `GET` siguiente refleja el
cambio. `updatedAt: now()` se fija desde `clock.ts` (política de US-32).

### CA-3 — El singleton sigue siendo único
Ninguna ruta puede crear una segunda fila: la CHECK de US-41 lo impide y el
servicio no lo intenta.

### CA-4 — Sin regresión
`just db-check`, `npx jest`, `just build-api` y `just verify` verdes con
recuentos. `/api/settings` sigue midiendo 5503 B: esta US no lo toca.

## Escenarios Gherkin

```gherkin
Feature: Pagina de hazte vendedor desde Postgres
  Scenario: CA-1 — la respuesta no cambia al migrar
    Given el singleton sembrado desde become-seller.json
    When GET de la ruta de become-seller
    Then el cuerpo es identico al que servia el JSON

  Scenario: CA-2 — editar el banner persiste
    Given el singleton en base
    When se actualiza el titulo del banner
    Then el GET siguiente lo devuelve cambiado
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/become-seller.repository.ts` | repositorio nuevo |
| `packages/db/src/repositories/become-seller.integration.test.ts` | tests de integración |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | lee y escribe Postgres |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | tests con `@safari/db` mockeado |

## Definición de Done

- [ ] Comparación de bytes del `GET` antes y después, pegada (CA-1).
- [ ] `curl` de la escritura y del `GET` posterior, pegados.
- [ ] `just db-check` y `npx jest` verdes con recuentos.
- [ ] `just build-api` y `just verify` verdes; `/api/settings` en 5503 B.
- [ ] Status de esta US actualizado y su fila marcada en el épico.

## Notas para el agente ejecutor

- **Es la candidata natural para ir primero tras US-41**: 2 rutas, sin
  relaciones, sin guards que preservar. Buena para validar que el DDL de
  US-41 sirve de verdad antes de meterse con `staffs`.
- El barrel `packages/db/index.ts` se comparte con US-42: quien arranque
  segundo rebasea.
- La comparación de CA-1 se hace con `node -e` sobre los dos cuerpos: `jq` no
  está instalado en el Git Bash de esta máquina.
