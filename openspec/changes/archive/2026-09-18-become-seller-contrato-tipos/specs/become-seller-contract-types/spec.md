# Delta for Become Seller Contract Types

## Purpose

Formaliza CA-1..CA-4 de US-45: la entidad y el DTO declaran el payload
real que `become-seller-page-api` sirve/acepta, OpenAPI lo publica y el
servicio deja de reinterpretar su DTO con escapes de tipos.
`become-seller-page-api` sigue dueño del contrato HTTP; CA-4 aquí lo
**re-verifica**, no lo modifica.

## ADDED Requirements

### Requirement: La entidad y el DTO describen el payload real (CA-1)

`BecomeSeller` MUST modelar: top-level exactamente `page_options` y
`commissions`; dentro de `page_options`, exactamente `id`,
`page_options` (objeto interno), `language`, `created_at`, `updated_at`.
El objeto interno MUST declarar las 24 claves reales. `banner` MUST ser
clase propia de 9 claves (`newsTickerTitle`, `newsTickerURL`, `title`,
`description`, `button1Name`, `button1Link`, `button2Name`,
`button2Link`, `image`), NOT `Attachment`. `CommissionItem.max_balance`
MUST tipar `string`; `guidelineItems[].link` MUST admitir `null`;
`userStories[].thumbnail` MUST ser objeto, no string.
`CreateBecomeSellerDto` MUST declarar `{ language?, page_options: <objeto
interno>, commissions }`, sin `id`. Ningún `missions` MUST sobrevivir
bajo el módulo.

#### Scenario: El envoltorio y el objeto interno coinciden con el payload real

- GIVEN `become-seller.entity.ts` tras el cambio
- WHEN se compara `BecomeSeller` con `Object.keys` del JSON real
- THEN las claves y tipos coinciden 1:1 (`max_balance` string,
  `guidelineItems[].link` nullable, `userStories[].thumbnail` objeto)

#### Scenario: El DTO del POST no exige campos que el admin no manda y `missions` desaparece

- GIVEN `CreateBecomeSellerDto` tras el cambio
- WHEN se inspeccionan sus propiedades y se ejecuta
  `grep -rn missions apps/api/rest/src/become-seller/`
- THEN el DTO tiene exactamente `language?`, `page_options`,
  `commissions` (sin `id`) y el `grep` está vacío

### Requirement: El documento OpenAPI publica el contrato verdadero (CA-2)

`GET /docs-json`, resuelto por `$ref` desde
`paths['/api/became-seller']` (nunca por nombre de schema fijo: el
agente puede renombrar clases), MUST mostrar: `post.requestBody` con
exactamente `language`/`page_options`/`commissions`, `required` sin `id`
ni `language`; `get.responses.200`/`post.responses.201` con top-level
exactamente `page_options`/`commissions`, y `page_options` en
`id`/`page_options`/`language`/`created_at`/`updated_at`; el objeto
interno con 24 propiedades; `banner` con 9 propiedades sin `Attachment`;
`max_balance` en `type: "string"` — depende de que `CommissionItem` sea
`class`, no `interface`: el plugin CLI de `@nestjs/swagger` solo emite
metadata para clases; una interfaz como array degenera a
`{type:"array",items:{type:"object"}}` sin `$ref`.

#### Scenario: El body del POST y las respuestas resueltos por `$ref`

- GIVEN la API levantada tras el cambio
- WHEN se lee `GET /docs-json` y se siguen los `$ref` de
  `post.requestBody`, `get.responses.200` y `post.responses.201`
- THEN cada uno expone las propiedades/`required` descritos arriba, con
  el objeto interno en 24 props y `banner` en 9

#### Scenario: `max_balance` es observable como string porque `CommissionItem` es clase

- GIVEN `CommissionItem` como `class` tras el cambio
- WHEN se resuelve su schema en `components.schemas` vía `$ref`
- THEN `max_balance` aparece como `type: "string"`, sin `oneOf`

### Requirement: El servicio no reinterpreta su DTO con escapes de tipos (CA-3)

`become-seller.service.ts` MUST NOT contener `as unknown as`, `as any`,
`@ts-ignore`, `@ts-expect-error` ni `: any`, ni en comentarios (D-5). El
tipo local `BecomeSellerWriteBody` MUST desaparecer; `create()` MUST leer
`dto.page_options`/`dto.commissions`/`dto.language` directamente del DTO
tipado. `_toEnvelope()` MUST devolver su literal sin cast.

#### Scenario: Cero escapes de tipos, incluidos comentarios

- GIVEN `become-seller.service.ts` tras el cambio
- WHEN se ejecuta `grep -n "as unknown as\|as any\|ts-ignore\|ts-expect-error" apps/api/rest/src/become-seller/become-seller.service.ts`
- THEN la salida está vacía

#### Scenario: `_toEnvelope()` compila sin cast

- GIVEN el literal de retorno de `_toEnvelope()` tras el cambio
- WHEN se compila el servicio
- THEN no lleva ningún `as` y el tipo declarado se satisface

### Requirement: Una red de tipos detecta drift del contrato interno (CA-3 / D-4)

El módulo MUST incluir un chequeo de tipo — no un spread del JSON
importado, porque TypeScript no aplica excess-property checking a
valores no literales — que falle a compilación si `commissions` se
renombra o se elimina cualquiera de las 24 claves internas, en ambas
direcciones. MUST usar `keyof`/`Exclude` (o un literal a mano con las 24
claves); MUST NOT usar `satisfies` (no existe en `typescript ^4.7.4`).
MUST complementarse con `Object.keys` en runtime. La corrección MUST
demostrarse: romper el tipo, pegar el error real (rojo), restaurarlo
(verde).

#### Scenario: Renombrar `commissions` rompe la compilación

- GIVEN el chequeo de tipos en verde
- WHEN se renombra `commissions` a `missions` en el DTO o la entidad
- THEN `npx jest` falla con un error real de TypeScript

#### Scenario: Eliminar una de las 24 claves rompe la compilación

- GIVEN el chequeo de tipos en verde
- WHEN se elimina cualquiera de las 24 claves de `BecomeSellerOptions`
- THEN la compilación falla en la dirección del chequeo `keyof`/
  `Exclude`, y al restaurar la clave vuelve a verde

### Requirement: Sin regresión de contrato HTTP ni de gates (CA-4)

`become-seller-page-api` MUST NOT cambiar de comportamiento: este
requirement lo re-verifica. `GET /api/became-seller` MUST seguir en
11 452 B y `deepStrictEqual` al cuerpo capturado **antes** del cambio
(fresco al aplicar, no la cifra de `sdd-explore`), excluyendo
`created_at`/`updated_at` del envoltorio. `POST` con el body real del
admin MUST seguir respondiendo 201 con el mismo envoltorio.
`/api/settings` MUST seguir en 5503 B. `npx jest` MUST cerrar
≥ 10 suites / ≥ 291 tests. `just build-api` MUST cerrar en verde (único
punto donde corre el plugin de Swagger). `just db-check` MUST cerrar
idéntico a la base (12 archivos / 228 tests). `git diff --stat` MUST
limitarse a `apps/api/rest/src/become-seller/`.

#### Scenario: El contrato HTTP se re-verifica sin cambiar

- GIVEN el cuerpo de `GET /api/became-seller` capturado antes del cambio
- WHEN se captura de nuevo tras el cambio
- THEN mide 11 452 B y es `deepStrictEqual` excluyendo
  `created_at`/`updated_at` del envoltorio

#### Scenario: Los gates cierran en verde y el diff queda acotado al módulo

- GIVEN el change aplicado
- WHEN se corren `npx jest`, `just build-api`, `just db-check`,
  `just verify` y `git diff --stat`
- THEN los cuatro comandos cierran en verde (jest ≥ 10/291, `db-check`
  en exactamente 12/228, `/api/settings` en 5503 B) y el diff solo
  toca `apps/api/rest/src/become-seller/`

## Out of Scope (heredado, vinculante, del "NO incluye" de la US)

- Contrato HTTP: propiedad de `become-seller-page-api`.
- Validadores `class-validator` en DTO/entidad.
- `packages/db`, `db/*.sql`, `apps/shop`, `apps/admin`, `settings`,
  `attachment.entity.ts`, `main.ts`, `nest-cli.json`, config de jest.
- Métodos muertos `update`/`findOne`/`remove`: se conservan.
