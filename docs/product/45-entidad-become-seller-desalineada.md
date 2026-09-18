# US-45 — Entidad y DTO de `become-seller` desalineados del contrato real

> `become-seller.entity.ts` describe un payload que no existe: declara
> `missions` donde el dato real es `commissions`, 12 de las 24 claves de
> `page_options`, un `banner` que no es un `Attachment` y un `max_balance`
> numérico que en la base es la string `"3000"`. El DTO del `POST` hereda
> todo eso por `OmitType`, el servicio de US-44 tuvo que esquivarlo con un
> tipo local y dos `as unknown as`, y `/docs` publica el contrato falso.

**Épico:** ninguno (US standalone)
**Fecha:** 2026-09-18
**Status:** Listo para ejecución
**Depende de:** US-44 (implementada; esta deuda nace de su «NO incluye»)
**LOC est.:** ~220

## Historia
**Como** mantenedor de la API y como consumidor de `/docs`, **quiero** que la
entidad y el DTO del módulo `become-seller` describan exactamente el cuerpo
que la ruta sirve y acepta, **para** que Swagger deje de publicar un contrato
falso, el servicio no necesite reinterpretar su propio DTO con `as unknown as`
y el siguiente agente que toque el módulo pueda confiar en los tipos.

## Contexto — verificado en código

Todas las rutas son relativas a la raíz del repo. Verificado el 2026-09-18
sobre la rama `us-44-corte-2-servicio` (HEAD `e9cce5d`), con la API
levantada en `:9001`.

### La forma real del payload (fuente de verdad)

Tres fuentes coinciden entre sí — se comprobó con `node -e` +
`assert.deepStrictEqual` que el seed y el JSON son idénticos, y el `GET` en
vivo devuelve lo mismo salvo los dos timestamps del envoltorio (divergencia
ya aceptada en US-44 CA-1):

- `apps/api/rest/src/db/pickbazar/become-seller.json` — el mock original.
- `db/seed.sql:33-35` — el `INSERT INTO become_seller (id, page_options,
  commissions, language)` que siembra el singleton.
- `GET http://localhost:9001/api/became-seller` — HTTP 200, **11 452 B**
  (medido hoy con `curl -w '%{size_download}'`).

Forma:

```
{
  page_options: {                       ← envoltorio (5 claves, en este orden)
    id: 1,
    page_options: { …24 claves… },      ← objeto interno
    language: "en",
    created_at, updated_at
  },
  commissions: [ …2 tiers… ]            ← HERMANA de page_options, top level
}
```

- Las **24 claves** del objeto interno (`become-seller.json:4-223`):
  `defaultCommissionRate`, `defaultCommissionDetails`, `banner`,
  `sellingStepsTitle`, `sellingStepsDescription`, `sellingStepsItem`,
  `userStoryTitle`, `userStoryDescription`, `purposeTitle`,
  `purposeDescription`, `purposeItems`, `commissionTitle`,
  `commissionDescription`, `isMultiCommissionRate`, `dashboard`,
  `guidelineTitle`, `guidelineDescription`, `guidelineItems`, `faqTitle`,
  `faqDescription`, `faqItems`, `contact`, `sellerOpportunity`,
  `userStories`.
- `banner` (`become-seller.json:7-22`) tiene **9 claves**: `newsTickerTitle`,
  `newsTickerURL`, `title`, `description`, `button1Name`, `button1Link`,
  `button2Name`, `button2Link`, `image`.
- `commissions[].max_balance` es **string** en los dos tiers: `"3000"`
  (`:235`) y `"1000"` (`:253`). `min_balance` y `commission` sí son números.
  Cada tier trae además `language`, `created_at`, `updated_at` (`:243-245`).
- Detalles que un tipado honesto tiene que admitir: `guidelineItems[].link`
  puede ser `null` (`:153`); `userStories[].thumbnail` es un **objeto**
  `{thumbnail, original, id, file_name}` (`:215-220`), no una string.

### El body real del `POST`

Lo arma el admin como objeto plano —`page_options` es directamente el objeto
interno de 24 claves, sin envoltorio— y lo manda por `POST` al mismo endpoint:

- Tipo: `BecomeSellerInput` en `apps/admin/rest/src/types/index.ts:2242-2246`
  = `{ language?: string; page_options: BecomeSellerOptionsInput;
  commissions: CommissionItem[] }`.
- `BecomeSellerOptionsInput` (`:2199-2240`) declara las 24 claves y un
  `banner` con las 9 claves reales. Es **la referencia correcta** para el
  objeto interno, junto con `Showcase` (`:2143-2151`, forma de `dashboard` y
  `sellerOpportunity`) y `UserStory` (`:2192-2197`).
- Construcción y envío: `apps/admin/rest/src/components/become-seller/become-seller-form.tsx:81-96`
  y `apps/admin/rest/src/data/client/become-seller.ts:19-23`.
- **Dos caveats del propio admin**, que NO se copian: su `CommissionItem`
  declara `max_balance: number` (`:2123`) pero su esquema yup lo valida como
  `string` (`become-seller-form-validation-schema.ts:197-199`, regex que
  admite `"over"`) y el input es de texto (`form-part/commission.tsx:180`);
  y su `UserStory.thumbnail: string` (`:2196`) contradice el objeto que hay
  en los datos. **Cuando el tipo del admin y el dato discrepan, gana el dato.**

### Lo que declara la entidad de Nest (`apps/api/rest/src/become-seller/entities/become-seller.entity.ts`)

Archivo heredado de Pickbazar sin una sola modificación desde el import
inicial (`git log`: solo `aed4d5b`, 2026-08-24).

| # | Defecto | Dónde | Realidad |
|---|---------|-------|----------|
| 1 | Campo **`missions`** | `:10` (`missions: CommissionItem[]`) | La clave es `commissions` (`become-seller.json:228`, `db/seed.sql:33`, admin `:2245`). La **posición** sí es correcta —hermana de `page_options` en el top level—; lo que está mal es el nombre. |
| 2 | `BecomeSellerOptions` con **12 campos** | `:13-26` | El objeto interno tiene **24 claves**. Faltan `defaultCommissionRate`, `defaultCommissionDetails`, `userStoryTitle`, `userStoryDescription`, `isMultiCommissionRate`, `dashboard`, `guidelineTitle`, `guidelineDescription`, `guidelineItems`, `contact`, `sellerOpportunity`, `userStories`. |
| 3 | `banner: Attachment` | `:14` | `Attachment` (`apps/api/rest/src/common/entities/attachment.entity.ts:3-6`) es `CoreEntity` + `thumbnail?` + `original?`, o sea `{id, created_at, updated_at, thumbnail?, original?}`. El banner real tiene las 9 claves listadas arriba y **ninguna** de las de `Attachment` en su nivel (su `image` sí es un adjunto). |
| 4 | `CommissionItem.max_balance: number` | `:52` | String `"3000"` / `"1000"`. |
| 5 | **Envoltorio mal modelado** (hallazgo adicional de esta redacción) | `:5-9` | `BecomeSeller extends CoreEntity` pone `id`, `created_at`, `updated_at` (`core.entity.ts:3-9`) y `language` (`:9`) en el **top level**, y deja `page_options` como `{ page_options }` a secas (`:6-8`). En el cuerpo real esas cuatro claves viven **dentro** de `page_options`; el top level son solo `page_options` y `commissions`. |

Efecto en cadena: `CreateBecomeSellerDto` es
`OmitType(BecomeSeller, ['created_at','updated_at'])`
(`apps/api/rest/src/become-seller/dto/create-become-seller.dto.ts:4-7`) y es
el tipo del `@Body()` del `POST` (`become-seller.controller.ts:13-16`), así
que hereda 1-4 y además exige `id` (que el admin nunca manda), exige
`language` (opcional en `BecomeSellerInput`) y anida `page_options` un nivel
más de lo que llega. `UpdateBecomeSellerDto` es `PartialType` del anterior
(`dto/update-become-seller.dto.ts:4`); solo lo usa el método muerto
`update()` del servicio (`become-seller.service.ts:62`), el controller no lo
cablea.

### La consecuencia que justifica la US

**a) El servicio esquiva su propio DTO.** `become-seller.service.ts` (reescrito
en US-44) declara el tipo local `BecomeSellerWriteBody` (`:24-28`) porque
`dto.commissions` **no compila** contra la entidad, y hace `as unknown as`
**dos veces**: `:50` (`createBecomeSellerDto as unknown as
BecomeSellerWriteBody`) y `:94` (`} as unknown as BecomeSeller` al devolver el
envoltorio). El comentario de `:12-23` lo documenta y cita esta deuda. La
decisión de no corregir la entidad quedó registrada como D-4 en
`openspec/changes/archive/2026-09-15-become-seller-postgres/design.md:151-179`
y como «mejora adyacente no accionada» en su `archive-report.md:195-196`.
El spec del servicio también necesita un cast para fabricar el DTO
(`become-seller.service.spec.ts:54-58`).

**b) Swagger publica un contrato falso — verificado en vivo.** El plugin CLI
de `@nestjs/swagger` está activo (`apps/api/rest/nest-cli.json:5`) y
`main.ts:16-17` genera y sirve el documento en `/docs`. El plugin lee las
clases de los archivos `*.entity.ts` / `*.dto.ts` y, además, **anota por su
cuenta las respuestas de los controladores** (`@ApiResponse`) con el tipo de
retorno inferido, aunque nadie haya decorado el método. Evidencia:

- Compilado (`just build-api`): `dist/become-seller/entities/become-seller.entity.js:7-8`
  emite `_OPENAPI_METADATA_FACTORY` con `missions: { required: true, type:
  () => [Object] }`; `dist/become-seller/become-seller.controller.js:34,42`
  lleva `openapi.ApiResponse({ status: 201|200, type: BecomeSeller })`
  inyectado por el plugin — nadie lo escribió a mano.
- En vivo, `GET http://localhost:9001/docs-json` (HTTP 200, 170 326 B):
  - `paths['/api/became-seller'].post.requestBody` → `$ref
    CreateBecomeSellerDto`, cuyo schema es `{ id: number, page_options: {
    page_options: $ref BecomeSellerOptions }, language: string, missions:
    array }` con `required: ["id","page_options","language","missions"]`.
  - `responses.200/201` → `$ref BecomeSeller`, con `id`, `language`,
    `created_at`, `updated_at` en el top level y `missions`.
  - `BecomeSellerOptions` → exactamente los 12 campos de la entidad;
    `banner` → `$ref Attachment`, que a su vez exige `id`, `created_at`,
    `updated_at`.

Un consumidor que genere un cliente desde `/docs-json` mandaría `missions` y
un `id`, y esperaría `language` en el top level de la respuesta.

**c) En runtime hoy NO cambia nada — y hay que saberlo para dimensionar.**
`main.ts:9` instancia `new ValidationPipe()` **sin opciones**: `whitelist`,
`forbidNonWhitelisted` y `transform` en `false`. La entidad no tiene **ningún**
decorador de `class-validator` (el único decorador es `@Type(() => Date)` de
`class-transformer` en `core.entity.ts:5,7`, que sin `transform` no hace
nada). Resultado: el body atraviesa el pipe íntegro sea cual sea el tipo
declarado; los tipos son **documentación y contrato de compilación**, no
validación. Esto es lo que hace que el defecto sea hoy «cosmético en
runtime + falso en `/docs` + deuda en el servicio», y lo que lo convertiría en
bug **latente**: si alguien añade validadores a la entidad tal cual (p. ej.
`@IsArray()` sobre `missions`), **todo** body real del admin respondería 400,
porque `missions` nunca llega; y si se activara `whitelist: true`, el pipe
descartaría `commissions` en silencio. El precedente del repo para un DTO con
validadores es `apps/api/rest/src/tags/dto/create-tag.dto.ts:21-34`; **esta
US no los añade** (ver Scope).

**d) El mismo nombre tiene tres grafías en el repo.** API: `missions`; shop:
`commission` (singular, `apps/shop/src/types/index.ts:1232-1237`); admin y
datos: `commissions`. Solo la de la API entra aquí; las otras dos se anotan
para quien toque frontend.

### Restricción verificada para el diseño

Con el envoltorio real, la respuesta (`{ page_options: {id, page_options,
language, created_at, updated_at}, commissions }`) y el body del `POST`
(`{ language?, page_options: <objeto interno plano>, commissions }`) tienen
**formas distintas** en `page_options`: no se puede derivar el DTO correcto
de la entidad correcta con un `OmitType`/`PickType` del top level. La
entidad (respuesta) y el DTO (body) tienen que declararse cada uno con su
forma, compartiendo las clases del objeto interno (`BecomeSellerOptions`,
`CommissionItem`, etc.). El cómo lo decide el agente dentro de esa
restricción.

## Scope

**Incluye:** realinear `become-seller.entity.ts` con el cuerpo real de la
respuesta (envoltorio correcto, `commissions`, 24 claves internas, `banner`
con sus 9 claves, `max_balance` string, `guidelineItems[].link` nullable,
`userStories[].thumbnail` objeto); declarar `CreateBecomeSellerDto` con la
forma real del body del `POST` (`language?`, `page_options` plano,
`commissions`, sin `id`); retirar de `become-seller.service.ts` el tipo local
`BecomeSellerWriteBody` y los dos `as unknown as`; ajustar
`become-seller.service.spec.ts` y añadir la red de regresión de CA-3;
verificar `/docs-json` antes y después.

**NO incluye:**

- **Cambiar el contrato HTTP.** `GET` y `POST /api/became-seller` devuelven
  exactamente el mismo cuerpo que hoy (11 452 B; deep-equal excluyendo
  `created_at`/`updated_at` del envoltorio), mismo verbo, mismo `@Public()`,
  misma ausencia de guard. El contrato congelado vive en
  `openspec/specs/become-seller-page-api/spec.md` y esta US no lo altera.
- **Añadir validadores de `class-validator`** al DTO o a la entidad. Hoy el
  `POST` acepta cualquier body y responde 201; introducir 400s es un cambio
  de superficie de error que merece su propia decisión (y su propio test de
  que el body real del admin sigue pasando). Si el agente cree que hacen
  falta, lo menciona en el reporte.
- Tocar la capa de datos `packages/db` (repositorio, records, barrel, tests
  de integración), `db/schema.sql` ni `db/seed.sql`.
- Tocar el frontend (`apps/shop`, `apps/admin`), incluidos sus tipos
  `BecomeSeller`/`CommissionItem`/`UserStory` con los mismos defectos.
- Tocar `settings` (tiene el mismo `as unknown as Setting` en
  `settings.service.ts:39` — candidata a una US hermana, no a esta), ni
  `common/entities/attachment.entity.ts` (compartida por decenas de módulos;
  que le falte `file_name` es otra deuda), ni ningún otro módulo.
- Cambiar `main.ts` (`ValidationPipe`, Swagger), `nest-cli.json` ni la
  configuración de jest.
- Los métodos muertos del servicio (`update`, `findOne`, `remove`,
  `become-seller.service.ts:59-72`): se conservan tal cual (D-6 de US-44).

## Criterios de aceptación

### CA-1 — La entidad y el DTO describen el payload real
`BecomeSeller` (tipo de retorno de `findAll()` y `create()`) modela el
envoltorio real: top level `page_options` y `commissions`; dentro de
`page_options`: `id`, `page_options` (objeto interno), `language`,
`created_at`, `updated_at`. El objeto interno declara las **24** claves con
los nombres exactos del JSON, `banner` con sus **9** claves (no
`Attachment`), `CommissionItem.max_balance` acepta la string `"3000"`,
`guidelineItems[].link` admite `null` y `userStories[].thumbnail` es objeto.
`CreateBecomeSellerDto` es `{ language?, page_options: <objeto interno>,
commissions }` sin `id` ni `created_at`/`updated_at`. No queda ningún campo
llamado `missions` en `apps/api/rest/src/become-seller/`.

Verificación: `grep -rn missions apps/api/rest/src/become-seller/` vacío;
`node -e` comparando `Object.keys` del objeto interno del JSON (24) con las
claves declaradas (ver CA-2 para la vía Swagger, que es la que lo hace
observable sin leer TypeScript).

### CA-2 — Swagger publica el contrato verdadero
Con la API levantada tras el cambio, `GET /docs-json` resuelve, para
`paths['/api/became-seller']`:

- `post.requestBody` → schema con propiedades exactamente `language`,
  `page_options`, `commissions`; `required` **sin** `id` ni `language`;
  `page_options` referencia el objeto interno de 24 propiedades.
- `get.responses.200` y `post.responses.201` → schema con propiedades
  top-level exactamente `page_options` y `commissions`, y `page_options` con
  exactamente `id`, `page_options`, `language`, `created_at`, `updated_at`.
- El schema del objeto interno tiene 24 propiedades cuyos nombres son
  iguales a `Object.keys(become-seller.json.page_options.page_options)`;
  `banner` **no** referencia `Attachment` y tiene 9 propiedades;
  `max_balance` es `type: "string"`.

Los nombres de los schemas (`components.schemas.*`) pueden cambiar si el
agente renombra clases: la comprobación sigue los `$ref` desde `paths`, no
nombres fijos. Se pega la salida de `node -e` sobre el documento **antes**
(hoy: `missions`, 12 propiedades, `banner → Attachment`) y **después**.

### CA-3 — Cero `as unknown as` en el servicio, sin trampas equivalentes
`become-seller.service.ts` no contiene `as unknown as`, ni `as any`, ni
`@ts-ignore`, ni `@ts-expect-error`, ni `: any`; desaparece el tipo local
`BecomeSellerWriteBody` y `create()` lee `dto.page_options`,
`dto.commissions` y `dto.language` directamente del DTO tipado.
`_toEnvelope()` devuelve el literal **sin cast** y compila porque el tipo es
correcto. `become-seller.service.spec.ts` deja de necesitar el cast de
`createDto()` o lo justifica en comentario si conserva el helper.

Red de regresión: un test (jest, en `apps/api/rest`) que **falle a
compilación o a ejecución** si se renombra `commissions` en el DTO o se
elimina una de las 24 claves del objeto interno — por ejemplo, asignar el
JSON real (`@db/become-seller.json`, mapeado en el `moduleNameMapper` de
`package.json`) a los tipos declarados **sin cast** y aseverar `Object.keys`.
`ts-jest` corre con diagnósticos por defecto (bloque `jest` de
`apps/api/rest/package.json`, sin `isolatedModules`), así que un error de
tipo tumba la suite; el agente verifica que **de verdad** falla rompiendo el
tipo a propósito y pega ambas salidas (rojo provocado + verde restaurado),
como hizo US-32 con W-1.

Verificación: `grep -n "as unknown as\|as any\|ts-ignore\|ts-expect-error" apps/api/rest/src/become-seller/become-seller.service.ts` vacío.

### CA-4 — Sin regresión de contrato ni de gates
- `GET /api/became-seller` sigue en **11 452 B** y su JSON parseado es
  `deepStrictEqual` al cuerpo capturado **antes** del cambio, excluyendo
  únicamente `created_at`/`updated_at` del envoltorio (mismo `node -e` de
  US-44 CA-1). El `POST` con el body real del admin sigue respondiendo 201
  con el mismo envoltorio (repetir la evidencia CA-2 de US-44 y restaurar la
  fila después).
- `/api/settings` sigue midiendo **5503 B** en `just verify` (`body.length`;
  `curl` reporta 5504 B de `Content-Length` por el `©` — ambos valores son
  el mismo estado, ver `CLAUDE.md`).
- `cd apps/api/rest && npx jest` verde: línea base **10 suites / 290 tests**
  (evidencia de US-44); esta US suma tests, no resta.
- `just build-api` verde (es el que ejecuta el plugin de Swagger: si la
  entidad tiene un tipo que el plugin no sabe serializar, se ve aquí).
- `just db-check` verde: línea base **12 archivos / 228 tests** — esta US no
  toca `packages/db`, así que debe quedar idéntico.
- `git diff --stat` muestra cambios **solo** en
  `apps/api/rest/src/become-seller/`.

## Escenarios Gherkin

```gherkin
Feature: Entidad y DTO de become-seller alineados con el contrato real

  Scenario: CA-2 — Swagger describe el body real del POST
    Given la API levantada tras el cambio
    When se lee GET /docs-json y se sigue el $ref de paths['/api/became-seller'].post.requestBody
    Then las propiedades son exactamente language, page_options y commissions
    And required no incluye id
    And el schema de page_options tiene 24 propiedades con los nombres del JSON
    And banner tiene 9 propiedades y no referencia Attachment
    And max_balance es de tipo string

  Scenario: CA-2 — Swagger describe el envoltorio real de la respuesta
    Given la API levantada tras el cambio
    When se sigue el $ref de paths['/api/became-seller'].get.responses.200
    Then las propiedades top-level son exactamente page_options y commissions
    And page_options tiene exactamente id, page_options, language, created_at y updated_at

  Scenario: CA-3 — el servicio no reinterpreta su DTO
    Given become-seller.service.ts tras el cambio
    When se busca "as unknown as", "as any", "ts-ignore" y "ts-expect-error"
    Then no hay ninguna coincidencia
    And create() lee dto.commissions sin tipo local intermedio

  Scenario: CA-3 — la red de regresion detecta un renombre
    Given el test que asigna become-seller.json a los tipos declarados sin cast
    When se renombra commissions a missions en el DTO
    Then la suite de jest falla
    And al restaurar el nombre vuelve a verde

  Scenario: CA-4 — el contrato HTTP no cambia
    Given el cuerpo de GET /api/became-seller capturado antes del cambio
    When se captura de nuevo tras el cambio
    Then mide 11452 B
    And el JSON parseado es deepStrictEqual excluyendo created_at y updated_at del envoltorio
    And /api/settings sigue en 5503 B
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/become-seller/entities/become-seller.entity.ts` | Reescritura: envoltorio real (sin heredar `CoreEntity` en el top level), `commissions`, objeto interno de 24 claves, clase propia para `banner`, `Showcase`/`GuidelineItem`/`UserStory`/`Contact`, `max_balance: string`, `link` nullable |
| `apps/api/rest/src/become-seller/dto/create-become-seller.dto.ts` | Deja de ser `OmitType(BecomeSeller)`; declara `{ language?, page_options, commissions }` con las clases compartidas del objeto interno |
| `apps/api/rest/src/become-seller/dto/update-become-seller.dto.ts` | Sin cambio esperado: `PartialType(CreateBecomeSellerDto)` se corrige solo. Verificar que compila |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | Retirar `BecomeSellerWriteBody` (`:24-28`) y los `as unknown as` de `:50` y `:94`; actualizar el comentario `:12-23`, que hoy documenta la deuda |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | Quitar o justificar el cast de `createDto()` (`:54-58`); añadir la red de regresión de CA-3 |

Sin cambios en: `become-seller.controller.ts`, `become-seller.module.ts`,
`main.ts`, `nest-cli.json`, `packages/db/**`, `db/**`, `apps/shop/**`,
`apps/admin/**`, `settings/**`, `common/**`.

## Definición de Done

- [ ] Salida de `node -e` sobre `/docs-json` **antes** del cambio pegada
      (debe mostrar `missions`, 12 propiedades en el objeto interno,
      `banner → Attachment`, `required` con `id`), y la misma salida
      **después** cumpliendo CA-2 punto por punto.
- [ ] `grep -rn missions apps/api/rest/src/become-seller/` vacío y
      `grep -n "as unknown as\|as any\|ts-ignore\|ts-expect-error"
      apps/api/rest/src/become-seller/become-seller.service.ts` vacío,
      pegados (CA-1, CA-3).
- [ ] Red de regresión de CA-3 demostrada: salida de `npx jest` en **rojo**
      con el tipo roto a propósito (renombre de `commissions`) y en **verde**
      restaurado, ambas pegadas con el mensaje de error de TypeScript.
- [ ] `curl` del `GET /api/became-seller` antes y después, con
      `size_download` = 11 452 B en ambos y el `deepStrictEqual` acotado
      (mismo script de US-44 CA-1) en `OK`; `POST` con el body real del
      admin → 201 + `GET` posterior reflejándolo, y `psql` de restauración
      de la fila (patrón de US-44 CA-2, comparación a resolución de
      milisegundo).
- [ ] `cd apps/api/rest && npx jest` verde con recuento (≥ 10 suites / ≥ 291
      tests: la línea base más la red nueva); `just build-api` verde;
      `just verify` con los tres `OK` y `/api/settings` en 5503 B;
      `just db-check` en 12 archivos / 228 tests, idéntico a la base.
- [ ] `git diff --stat` pegado, limitado a `apps/api/rest/src/become-seller/`.
- [ ] Reporte final con las mejoras adyacentes **mencionadas y no
      accionadas**: `settings.service.ts:39`, `attachment.entity.ts` sin
      `file_name`, tipos del shop (`commission`) y del admin
      (`max_balance: number`, `thumbnail: string`), y si el agente cree que
      hacen falta validadores en el DTO.
- [ ] Status de esta US actualizado a `Implementada` con la LOC real.

## Notas para el agente ejecutor

- **`jq` NO está instalado** en el Git Bash de esta máquina. Todas las
  comparaciones de JSON (`/docs-json`, cuerpos de `GET`) se hacen con
  `node -e` y `require('assert').deepStrictEqual`, como en US-44. Un
  esqueleto útil para CA-2 (comillas simples por fuera: con dobles, bash
  expandiría `$ref`):

  ```bash
  curl -s http://localhost:9001/docs-json > "$TMPDIR/docs.json"
  node -e '
    const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ref = (r) => doc.components.schemas[r.split("/").pop()];
    const post = doc.paths["/api/became-seller"].post;
    const body = ref(post.requestBody.content["application/json"].schema.$ref);
    console.log("body props:", Object.keys(body.properties), "required:", body.required);
    const resp = ref(post.responses["201"].content["application/json"].schema.$ref);
    console.log("resp props:", Object.keys(resp.properties));
  ' "$TMPDIR/docs.json"
  ```
- **El plugin de Swagger solo corre en `nest build`/`nest start`**, no en
  `ts-jest`: la evidencia de CA-2 sale de la API levantada (`just api-dev`,
  luego `curl http://localhost:9001/docs-json`), nunca de un test de jest.
  Por la misma razón, `just build-api` es un gate real de esta US y no un
  formalismo.
- Capturar el cuerpo del `GET` **antes** de tocar nada (`curl -s
  http://localhost:9001/api/became-seller > antes.json`), o el
  `deepStrictEqual` de CA-4 no tendrá contra qué comparar. Guardar la
  captura fuera del repo.
- La forma correcta del objeto interno está en tres sitios que coinciden
  (JSON, `db/seed.sql:33-35`, `GET` en vivo); la del body del `POST`, en
  `BecomeSellerInput`/`BecomeSellerOptionsInput` del admin
  (`apps/admin/rest/src/types/index.ts:2199-2246`). **Cuando el tipo del
  admin y el dato discrepan, gana el dato** (`max_balance`, `thumbnail`).
- Sobre `max_balance`: el dato sembrado es string, el esquema yup del admin
  valida string, pero el default de un tier nuevo en el formulario es el
  número `0` (`form-part/commission.tsx:243`) hasta que el usuario escribe.
  Declararlo `string` (lo que hay persistido) o `string | number` es una
  decisión del agente: elegir una, declararla en el reporte y no inventar
  una tercera.
- `BecomeSeller extends CoreEntity` es el origen del defecto 5: el envoltorio
  no es una `CoreEntity` en su top level. Modelar el envoltorio de forma
  explícita; `CoreEntity`/`Attachment` siguen valiendo para `image`.
- El comentario `become-seller.service.ts:12-23` y el D-4 archivado
  describen la deuda con detalle; al cerrarla, dejar el comentario del
  servicio diciendo lo que **es**, no lo que fue. No editar los artefactos
  archivados de `openspec/changes/archive/`.
- Presupuesto: ~220 LOC de diff (entidad ~55 → ~120, DTO ~7 → ~25, servicio
  −15/+5, spec ~+40). Entra en las 400 líneas de revisión de una US
  standalone. Si al escribir la entidad el conteo se dispara (p. ej. por
  duplicar clases del objeto interno entre entidad y DTO en vez de
  compartirlas), es señal de que el diseño está mal, no de que la
  estimación lo estaba.
