# Proposal: entidad y DTO de `become-seller` alineados con el contrato real (US-45)

> Evidencia: `exploration.md` (cero drift contra `main` `f50b145`).

## Intent

`become-seller.entity.ts` describe un payload inexistente: `missions` donde el
dato es `commissions` (`:10`), 12 de las 24 claves internas (`:13-26`),
`banner: Attachment` (`:14`), `max_balance: number` donde la base guarda `"3000"`
(`:52`) y `CoreEntity` en el top level, no en el envoltorio (`:5-9`). El DTO lo
hereda por `OmitType` y `/docs-json` publica ese contrato falso. US-44 lo esquivó
con un tipo local (`service.ts:24-28`) y dos `as unknown as` (`:50`, `:94`), y
registró la omisión como D-4 en
`archive/2026-09-15-become-seller-postgres/design.md:151-179`. **Este change
revierte esa decisión**, deliberada y temporal, no un descuido.

## Scope

### In Scope

1. Entidad: envoltorio real, `commissions`, 24 claves internas, `banner` de 9
   claves, `max_balance` string, `link` nullable, `thumbnail` objeto.
2. DTO: `{ language?, page_options (plano), commissions }`, sin `id` ni
   timestamps; deja de derivarse con `OmitType`.
3. Servicio: fuera `BecomeSellerWriteBody` y los dos `as unknown as`; comentario
   `:12-23` reescrito (D-5).
4. Spec: cast de `createDto()` fuera + red de CA-3.
5. Evidencia `/docs-json` antes y después.

### Out of Scope (vinculante — el «NO incluye» de la US)

- **Cambiar el contrato HTTP.** Mismas rutas, verbos, `@Public()` y cuerpo
  (11 452 B). `openspec/specs/become-seller-page-api/spec.md` no se altera.
- **Añadir validadores de `class-validator`** al DTO o a la entidad.
- `packages/db`, `db/schema.sql`, `db/seed.sql`, `apps/shop`, `apps/admin`,
  `settings`, `common/entities/attachment.entity.ts`, otros módulos.
- `main.ts`, `nest-cli.json`, configuración de jest.
- Métodos muertos `update`/`findOne`/`remove` (`:59-72`): se conservan (D-6 de
  US-44).

**Deuda adyacente — mencionada, NO accionada** (candidatas a US hermanas):
`settings.service.ts:39` (mismo patrón); `attachment.entity.ts` sin `file_name`;
shop `types/index.ts:1232-1237` (`commission` singular); admin
`types/index.ts:2123` (`max_balance: number`) y `:2196` (`thumbnail: string`).

## Capabilities

### New Capabilities

- `become-seller-contract-types`: los tipos declarados (entidad, DTO) describen
  el cuerpo real que la ruta sirve y acepta, el documento OpenAPI lo refleja y
  el servicio no reinterpreta su DTO.

### Modified Capabilities

- None. `become-seller-page-api` congela el contrato HTTP y este change lo
  preserva (CA-4): ninguna de sus requirements cambia de comportamiento; CA-4 lo
  **re-verifica**, no lo modifica.

## Approach

### D-1 — Opción A: clases compartidas en la entidad, importadas por el DTO

Se adopta lo recomendado por la exploración. El objeto interno de 24 claves es
**idéntico** en GET y POST; solo difiere el top level, así que no se deriva
nada: sus clases (`Banner`, `Showcase`, `GuidelineItem`, `UserStory`,
`Contact`, `CommissionItem`, `BecomeSellerOptions`) se declaran en
`become-seller.entity.ts` y el DTO las importa — dirección que el módulo **ya
usa**. `CoreEntity` no se descarta: baja a `BecomeSellerEnvelope`, el nivel donde
el dato sí tiene `id`/`created_at`/`updated_at`, corrigiendo el defecto 5 sin
inventar un envoltorio genérico.

Rechazadas con evidencia: **B** (archivo compartido nuevo) añade superficie que
la tabla de la US no lista, sin beneficio con un consumidor por lado; **C**
(`PickType`/`IntersectionType` en el objeto interno) no recortaría nada —no hay
subconjunto real— y añadiría indirección.

### D-2 — `CommissionItem` pasa de `interface` a `class` (adición a la tabla de la US)

El plugin CLI de `@nestjs/swagger` solo emite `_OPENAPI_METADATA_FACTORY` para
**clases**. Como `CommissionItem` es hoy interfaz (`entity.ts:46-55`), su schema
degenera a `{"type":"array","items":{"type":"object"}}` sin `$ref` — verificado
en vivo. **CA-2 exige `max_balance` como `type: "string"`, inalcanzable mientras
siga siendo interfaz.** La tabla «Archivos a crear / modificar» de la US no la
nombra: es **consecuencia necesaria de CA-2**, no scope creep, y se declara aquí
como adición explícita a esa tabla. Mismo patrón que `SellingStepItem`/
`FaqItems`, ya clases en el archivo.

### D-3 — `max_balance: string` (decisión que la US deja abierta)

`string` a secas: es lo persistido en los dos tiers (`"3000"`, `"1000"`), lo que
valida el yup del admin, y CA-2 exige literalmente `type: "string"` — una unión
`string | number` se serializaría como `{oneOf:[...]}` e **incumpliría la CA**.
El default numérico `0` del formulario del admin queda fuera de scope.

### D-4 — Red de regresión de CA-3: aserción a nivel de tipo, no asignación

La exploración **probó** que el test naive (asignar el JSON importado o un spread
al tipo del DTO) NO falla a compilación: TypeScript aplica excess-property
checking solo a literales escritos a mano, y el subtipado estructural admite lo
«ancho» en lo «angosto». Además `satisfies` **no existe aquí**
(`typescript: ^4.7.4`; llegó en 4.9). Mecanismo comprometido: aserción
`keyof`/`Exclude` que enumere las 24 claves y falle en **ambas** direcciones
(clave de más o de menos), más `Object.keys(...)` en runtime. Alternativa
aceptable: literal a mano con las 24 claves; `sdd-design` fija cuál. El DoD exige
**demostrarlo**: romper `commissions`→`missions` y pegar el rojo real de
TypeScript y el verde.

### D-5 — El comentario del servicio se reescribe sin la frase literal

`become-seller.service.ts:12-23` documenta hoy la deuda con la subcadena literal
`as unknown as` en prosa, y el grep de cierre de CA-3 coincide con comentarios.
El comentario nuevo MUST describir **lo que el código es** sin repetir esa frase
ni en pasado ni negada, o la verificación dará falso positivo.

### D-6 — Tipado de las imágenes (a fijar en `sdd-design`)

`Attachment` no tiene `file_name` y el dato sí lo trae. Como
`attachment.entity.ts` **no se toca**, valen dos salidas: usar `Attachment` y
aceptar la divergencia heredada, o declarar la forma local
`{id, thumbnail, original, file_name}`. Ambas respetan el scope.

## Affected Areas

Rutas relativas a `apps/api/rest/src/become-seller/`:

| Área | Impacto | Descripción |
|------|---------|-------------|
| `entities/become-seller.entity.ts` | Modified | Reescritura: ~10 clases, envoltorio real, `CommissionItem` a clase |
| `dto/create-become-seller.dto.ts` | Modified | Declarado a mano, importa las clases compartidas |
| `dto/update-become-seller.dto.ts` | Sin cambio | `PartialType` se corrige solo; solo se verifica compilación |
| `become-seller.service.ts` | Modified | Fuera el tipo local y los 2 casts; comentario reescrito (D-5) |
| `become-seller.service.spec.ts` | Modified | Cast de `createDto()` + red de CA-3 |
| Fuera de ese directorio | **Sin tocar** | `git diff --stat` debe quedar acotado |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| La red de CA-3 «parece test» pero no protege nada | **Alta** sin D-4 | D-4 + demostración rojo/verde exigida por el DoD |
| `guidelineItems[].link` no sale `nullable: true` solo | Media | `@ApiProperty({ nullable: true })` puntual: decorador de documentación, NO `class-validator`; verificar en `/docs-json` |
| El plugin no sabe serializar un tipo nuevo | Baja | `just build-api` es gate real (170 s medidos) |
| Se mueve el orden de claves y CA-4 falla | Baja | El orden lo fija el literal de `_toEnvelope()`, no la clase; no tocarlo |
| El grep de CA-3 da falso positivo | Media | D-5 |

## Rollback Plan

**Perfil de riesgo honesto**: `main.ts:9` instancia `new ValidationPipe()` sin
opciones y ni la entidad ni el DTO llevan decoradores de `class-validator`. En
runtime este change es **inerte**: corrige compilación y documentación OpenAPI;
no puede alterar el manejo de peticiones. El rollback es barato y cerrado:

1. `git revert <commit>` (o `git checkout -- apps/api/rest/src/become-seller/`):
   **un directorio**, cinco archivos.
2. `just build-api` (regenera `dist/` y el documento Swagger).
3. `npx jest` en `apps/api/rest` confirma la base (10 suites / 290).

**No hay** migración de datos, DDL, seed, contrato HTTP ni cliente que revertir;
`just db-reset` no interviene. Si un `POST` de prueba editó la fila 1, se
restaura con el patrón de US-44 CA-2 (`psql` + `just db-up`).

## Dependencies

US-44 (archivada). Evidencia: Postgres arriba (`just db-up`), `just db-build`
antes de jest y la API levantada (`just api-dev`) — el plugin de Swagger **no**
corre bajo `ts-jest`.

## Previsión de tamaño

Presupuesto de la US: **~220 LOC** (entidad 55→120, DTO 7→25, servicio −15/+5,
spec +40). D-2 suma ~4 líneas y D-4 unas ~30 → horquilla **~230-260 líneas** en
`git diff --stat` acotado a `apps/api/rest/src/become-seller/`.

- `400-line budget risk: Low` — holgura de ~140 líneas.
- `delivery_strategy: single-pr` es **plausible**; no se recomienda encadenar.
- Si el conteo se dispara, la causa esperada es duplicar las clases internas
  entre entidad y DTO: señal de diseño, no de estimación.

## Success Criteria

- [ ] CA-1: `grep -rn missions apps/api/rest/src/become-seller/` vacío.
- [ ] CA-2: `/docs-json` antes y después; `requestBody` con exactamente `language`/`page_options`/`commissions`, `required` sin `id` ni `language`; 24 props internas; `banner` con 9 props y sin `$ref Attachment`; `max_balance` en `type: "string"`.
- [ ] CA-3: grep de `as unknown as|as any|ts-ignore|ts-expect-error` vacío en el servicio (sin falso positivo, D-5); red demostrada en rojo y verde con el error real de TypeScript.
- [ ] CA-4: `GET` en 11 452 B + `deepStrictEqual` acotado; `POST` → 201 y fila restaurada; `npx jest` ≥ 10 suites / ≥ 291; `just build-api` verde; `just verify` con `/api/settings` en 5503 B; `just db-check` en 12/228.
- [ ] `git diff --stat` limitado a `apps/api/rest/src/become-seller/`.
- [ ] Reporte con la deuda adyacente y el veredicto sobre validadores.
