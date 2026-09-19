# Exploración — `become-seller-contrato-tipos` (US-45)

> Fuente de la tarea: `docs/product/45-entidad-become-seller-desalineada.md`.
> Esta exploración NO implementa nada. Verifica las afirmaciones del US
> contra el código real en `main` (`f50b145`), fija la forma exacta del
> payload, compara diseños de entidad/DTO y deja evidencia "antes" para
> CA-2/CA-4.

## 1. Verificación de las afirmaciones del US contra `main` (`f50b145`)

El US se escribió sobre `us-44-corte-2-servicio` (`e9cce5d`); el repo hoy
está en `main` (`f50b145`, limpio: `e9cce5d` es un ancestro directo, entre
medio solo se archivó documentación de US-44 — commits `16e67ca`,
`c6f5cf7`→ya incluido, `e9cce5d`, `f50b145`). Se releyeron TODOS los
archivos y líneas citados. **Resultado: cero drift.** Cada línea citada
apunta exactamente a lo que el US describe, palabra por palabra:

| Archivo:línea citado | Afirmación del US | Verificado |
|---|---|---|
| `become-seller.entity.ts:10` | `missions: CommissionItem[]` | ✅ idéntico |
| `become-seller.entity.ts:13-26` | `BecomeSellerOptions` con 12 campos | ✅ exactamente 12: banner, sellingStepsTitle, sellingStepsDescription, sellingStepsItem, purposeTitle, purposeDescription, purposeItems, commissionTitle, commissionDescription, faqTitle, faqDescription, faqItems |
| `become-seller.entity.ts:14` | `banner: Attachment` | ✅ |
| `become-seller.entity.ts:52` | `max_balance: number` | ✅ |
| `become-seller.entity.ts:5-9` | envoltorio mal modelado (`extends CoreEntity` + `page_options: {page_options}` + `language` en top level) | ✅ |
| `create-become-seller.dto.ts:4-7` | `OmitType(BecomeSeller, ['created_at','updated_at'])` | ✅ idéntico |
| `update-become-seller.dto.ts:4` | `PartialType(CreateBecomeSellerDto)` | ✅ |
| `become-seller.service.ts:24-28` | interfaz local `BecomeSellerWriteBody` | ✅ idéntico |
| `become-seller.service.ts:50` | `as unknown as BecomeSellerWriteBody` | ✅ |
| `become-seller.service.ts:94` | `} as unknown as BecomeSeller` | ✅ |
| `become-seller.service.ts:12-23` | comentario que documenta la deuda | ✅ |
| `become-seller.service.ts:59-72` | métodos muertos `update`/`findOne`/`remove` | ✅ |
| `become-seller.service.spec.ts:54-58` | `createDto()` con cast | ✅ idéntico |
| `become-seller.controller.ts:13-16` | `@Post()`/`create()` | ✅ |
| `common/entities/attachment.entity.ts:3-6` | `Attachment extends CoreEntity {thumbnail?, original?}` | ✅ |
| `common/entities/core.entity.ts:3-9` | `CoreEntity {id, created_at, updated_at}` | ✅ |
| `nest-cli.json:5` | plugin `@nestjs/swagger` activo | ✅ |
| `main.ts:9` | `new ValidationPipe()` sin opciones | ✅ |
| `main.ts:16-17` | `SwaggerModule.createDocument` + `.setup('docs', ...)` | ✅ |
| `become-seller.json:4-223` | objeto interno | ✅ (línea 4 abre, 223 cierra) |
| `become-seller.json:7-22` | `banner` (9 claves) | ✅ |
| `become-seller.json:153` | `guidelineItems[4].link === null` | ✅ |
| `become-seller.json:215-220` | `userStories[0].thumbnail` objeto | ✅ |
| `become-seller.json:228,235,253` | `commissions`, `max_balance:"3000"/"1000"` | ✅ |
| `db/seed.sql:33-35` | `INSERT INTO become_seller` | ✅ idéntico (incluye `ON CONFLICT` en :35) |
| `apps/admin/rest/src/types/index.ts:2123` | `CommissionItem.max_balance: number` | ✅ |
| `:2143-2151` | `Showcase` | ✅ |
| `:2192-2197` | `UserStory` | ✅ |
| `:2199-2240` | `BecomeSellerOptionsInput` (24 claves) | ✅ |
| `:2242-2246` | `BecomeSellerInput` | ✅ |
| `apps/shop/src/types/index.ts:1232-1237` | `commission` (singular) | ✅ |
| `settings.service.ts:39` | `as unknown as Setting` | ✅ |
| `design.md:151-179` (D-4) | decisión archivada de no corregir la entidad | ✅ (D-4 empieza en :151, D-5 en :181) |
| `archive-report.md:195-196` | mejora adyacente no accionada | ✅ idéntico |

**No hay ninguna afirmación sin confirmar ni ninguna con drift.** El único
matiz: el US dice "HEAD `e9cce5d`" pero el repo avanzó a `f50b145` con dos
commits más (archivado de docs + esta US-45 documentada) que no touchan
`apps/api/rest/src/become-seller/` — confirmado con
`git log --oneline e9cce5d..f50b145 -- apps/api/rest/src/become-seller/`
(vacío). El código bajo análisis es *byte a byte* el mismo que el US
describió.

### Hallazgo adicional no citado por el US (verificado en vivo, ver §5)

`CommissionItem` es una **interfaz**, no una clase
(`become-seller.entity.ts:46-55`). El plugin CLI de `@nestjs/swagger` solo
emite `_OPENAPI_METADATA_FACTORY` para **clases**; para una interfaz usada
como tipo de un array, degenera a `{type: "array", items: {type:
"object"}}` sin ningún `$ref`. Verificado en `/docs-json` en vivo (§5):
`BecomeSeller.properties.missions` es literalmente
`{"type":"array","items":{"type":"object"}}` y no existe ningún schema
`CommissionItem` en `components.schemas`. **Esto es un bloqueador directo
de CA-2**: la CA exige que el schema muestre `max_balance` como
`type: "string"`, y eso es imposible mientras `CommissionItem` siga siendo
una interfaz — tiene que pasar a ser una **clase** (mismo patrón que
`SellingStepItem`/`BusinessPurposeItem`/`FaqItems`, que sí son clases en el
mismo archivo).

## 2. Forma real del payload (ground truth, medida con `node -e`)

Confirmado sobre el JSON real (no hace falta `jq`):

```
top-level keys: ['page_options', 'commissions']
wrapper keys:   ['id', 'page_options', 'language', 'created_at', 'updated_at']
inner key count: 24
inner keys: defaultCommissionRate, defaultCommissionDetails, banner,
  sellingStepsTitle, sellingStepsDescription, sellingStepsItem,
  userStoryTitle, userStoryDescription, purposeTitle, purposeDescription,
  purposeItems, commissionTitle, commissionDescription,
  isMultiCommissionRate, dashboard, guidelineTitle, guidelineDescription,
  guidelineItems, faqTitle, faqDescription, faqItems, contact,
  sellerOpportunity, userStories
banner keys (9): newsTickerTitle, newsTickerURL, title, description,
  button1Name, button1Link, button2Name, button2Link, image
commissions[0] keys (11): id, level, sub_level, description, min_balance,
  max_balance, commission, image, language, created_at, updated_at
guidelineItems[4].link: null
userStories[0].thumbnail: object {thumbnail, original, id, file_name}
```

Formas TS necesarias para los miembros incómodos (referencia para
`sdd-design`, no implementadas aquí):

- `guidelineItems: { title: string; link: string | null }[]`
- `userStories: { title: string; description: string; link: string;
  thumbnail: Attachment }[]` — el `thumbnail` es exactamente la forma de
  `Attachment` (`{id, created_at?, updated_at?, thumbnail, original,
  file_name}`)... **matiz**: `Attachment` actual (`common/entities/
  attachment.entity.ts`) NO tiene `file_name`, y el dato sí lo trae
  (`file_name: "hero.png"`, etc., en `banner.image`, `dashboard.image`,
  `sellerOpportunity.image`, `sellingStepsItem[].image`,
  `userStories[].thumbnail`, `commissions[].image`). Esta US **no puede
  tocar** `attachment.entity.ts` (NO incluye explícito), así que cualquier
  clase de imagen propia de este módulo (`banner.image`, etc.) declarada
  como `Attachment` quedará **sin `file_name`** — divergencia ya conocida
  y documentada como deuda adyacente en el propio US ("mejora adyacente no
  accionada"), no una regresión nueva. Si el agente prefiere ser honesto al
  100%, puede declarar un tipo local `{thumbnail, original, id, file_name}`
  para estos campos de imagen SIN extender `Attachment` — es una decisión
  de diseño razonable dentro del scope (no toca `attachment.entity.ts`,
  solo evita heredar de él donde no calza). Mencionarlo en el reporte.
- `dashboard` / `sellerOpportunity`: forma `Showcase` del admin (`title,
  description, buttonName, buttonLink, button2Name, button2Link, image`).
- `contact`: `{ title: string; description: string }`.
- `commissions[].max_balance`: **decisión abierta** — ver §6.

## 3. Comparación de diseños entidad/DTO

Restricción verificada (§2): el envoltorio de la respuesta y el body del
`POST` difieren en la forma de `page_options` (uno anida
`{id, page_options, language, created_at, updated_at}`, el otro es el
objeto interno plano), pero **el objeto interno de 24 claves es
IDÉNTICO** en ambos lados (mismas clases: `BecomeSellerOptions`, `Banner`,
`CommissionItem`, `Showcase`, `GuidelineItem`, `UserStory`, `Contact`,
`PurposeItem`, `SellingStepItem`, `FaqItem`). Esto cambia el problema: no
hace falta derivar el DTO de la entidad con `OmitType`/`PickType` en
ningún nivel — basta **compartir las clases del objeto interno** y
declarar cada top-level (entidad, DTO) a mano.

### Opción A — Clases compartidas declaradas en `become-seller.entity.ts`, importadas por el DTO

```ts
// entities/become-seller.entity.ts
export class Banner { /* 9 campos */ }
export class Showcase { /* 7 campos */ }
export class GuidelineItem { title: string; link: string | null; }
export class UserStory { title: string; description: string; link: string; thumbnail: ImageLike; }
export class Contact { title: string; description: string; }
export class CommissionItem { /* clase, no interface — 8 campos + language/created_at/updated_at */ }
export class BecomeSellerOptions { /* 24 campos */ }

export class BecomeSellerEnvelope extends CoreEntity {
  page_options: BecomeSellerOptions;
  language: string;
}
export class BecomeSeller {
  page_options: BecomeSellerEnvelope;
  commissions: CommissionItem[];
}

// dto/create-become-seller.dto.ts
import { BecomeSellerOptions, CommissionItem } from '../entities/become-seller.entity';
export class CreateBecomeSellerDto {
  language?: string;
  page_options: BecomeSellerOptions;
  commissions: CommissionItem[];
}
```

Nótese que **`CoreEntity` sigue siendo válido** (nota del propio US): el
defecto no es que la entidad use `CoreEntity`, es que lo use en el nivel
equivocado. Bajarlo a `BecomeSellerEnvelope` corrige el defecto 5 sin
inventar una clase nueva de "envoltorio genérico" — reutiliza lo que ya
existe, exactamente donde el dato real lo tiene (`id`, `created_at`,
`updated_at` viven dentro de `page_options`, no en el top level).

- **Pros**: dirección de import idiomática en Nest (DTOs importan de
  `entities/`, igual que hoy `create-become-seller.dto.ts` ya importa
  `BecomeSeller` de la entidad). Cero archivos nuevos — cabe en la tabla
  de "Archivos a crear/modificar" del US sin ampliarla. LOC más bajo:
  las clases se escriben una sola vez.
- **Cons**: `become-seller.entity.ts` crece a ~10 clases en un archivo
  (dentro del presupuesto: el US ya estima entidad 55→120 LOC contando
  esto). Mezcla conceptualmente "lo que la API devuelve" con "lo que
  comparten ambos lados", pero es el patrón que Pickbazar/Nest usa en
  el resto del repo (p. ej. `SellingStepItem`/`BusinessPurposeItem` ya
  viven en este mismo archivo hoy).

### Opción B — Módulo compartido nuevo (`entities/become-seller-options.entity.ts`)

Mismas clases, pero en un archivo neutral que importan tanto
`become-seller.entity.ts` como `create-become-seller.dto.ts`.

- **Pros**: ninguna dirección de import "presta" del otro lado; si en el
  futuro el DTO necesitara algo que hoy vive en la entidad, no hay
  acoplamiento direccional que romper.
- **Cons**: añade un archivo que la tabla "Archivos a crear/modificar" del
  US **no lista** (solo lista 5 archivos, todos existentes) — el US no lo
  prohíbe explícitamente, pero el patrón de "si el conteo se dispara es
  señal de diseño mal, no de estimación mal" empuja a NO añadir superficie
  nueva sin necesidad. Para un módulo con un solo consumidor de cada lado
  (entidad, DTO), la ganancia de aislamiento no paga el archivo adicional
  dentro de un presupuesto de ~220 LOC.

### Opción C — `PickType`/`IntersectionType` a nivel del objeto interno

Explorado y **descartado**: como el objeto interno es idéntico en ambos
lados (no hay subconjunto/superconjunto real), `PickType`/`OmitType`
sobre `BecomeSellerOptions` no recortaría nada — sería una capa de
indirección sin función, y el plugin de Swagger tiene que resolver un
`$ref` más para llegar al mismo resultado. `IntersectionType` tendría
sentido solo si POST y GET tuvieran campos *adicionales* y no
superpuestos en el objeto interno, que no es el caso (verificado en §2).
Mencionar esta opción en el reporte final como alternativa considerada y
rechazada con evidencia, no callarla.

### Recomendación

**Opción A.** Es la que menos superficie nueva introduce, respeta el
presupuesto de LOC, sigue el patrón de import ya existente en el propio
módulo (`create-become-seller.dto.ts` ya importa de `entities/`), y
resuelve el defecto 5 reutilizando `CoreEntity` en el nivel correcto en
vez de inventar un envoltorio genérico. Además convertir `CommissionItem`
de interfaz a clase (necesario para CA-2, §1) es un cambio de una palabra
(`interface` → `class`) que cabe naturalmente en esta opción.

## 4. Red de regresión de CA-3 — investigación

`apps/api/rest/package.json` confirma: `moduleNameMapper` mapea
`^@db/(.*)$` → `<rootDir>/db/pickbazar/$1` con `rootDir: "src"`, es decir
`@db/become-seller.json` resuelve al **mock real**
(`src/db/pickbazar/become-seller.json`), no a un fixture. El bloque
`transform` usa `ts-jest` **sin** `isolatedModules` (no aparece en la
config), lo que significa que `ts-jest` corre el type-checker completo de
TypeScript por archivo — un error de tipo en un spec tumba esa suite
(confirmado: es el comportamiento por defecto de `ts-jest` en modo
completo, a diferencia del modo `isolatedModules` que solo transpila).
`tsconfig.json` tiene `resolveJsonModule: true` y `esModuleInterop: true`,
así que `import becomeSellerJson from '@db/become-seller.json'` funciona
y TypeScript infiere el tipo literal completo del JSON (las 24 claves,
`max_balance` como `string`, etc.) sin necesitar cast.

**No hay precedente exacto en el repo** de un spec que importe el JSON de
`@db/*` para un chequeo de tipos sin cast (se buscó `@db/` en
`**/*.spec.ts`: cero resultados). El "W-1 de US-32" que el US cita como
precedente es un patrón distinto (evidencia rojo/verde de un `it` que se
rompe a propósito para demostrar que un test SÍ detecta una regresión),
no la técnica de importar JSON — el precedente es metodológico
(demostrar el rojo provocado), no de código.

**Matiz importante encontrado al diseñar el chequeo**: TypeScript NO
aplica "excess property checking" cuando el valor asignado no es un
literal de objeto escrito a mano (variables, spreads y valores importados
quedan exentos). Esto significa que un test naive como:

```ts
const dto: CreateBecomeSellerDto = {
  language: becomeSellerJson.page_options.language,
  page_options: { ...becomeSellerJson.page_options.page_options },
  commissions: becomeSellerJson.commissions,
};
```

**NO fallará a compilación** si alguien borra una de las 24 claves de
`BecomeSellerOptions` (la asignación de un objeto "más ancho" a un tipo
"más angosto" es válida en TS por subtipado estructural — solo se rompe
si falta una clave *requerida* del lado angosto, no si el angosto perdió
una clave que el ancho sí tiene). Para que el borrado de una clave
rompa la compilación de verdad, hace falta uno de:

1. Un chequeo a nivel de tipo (`keyof`) tipo:
   ```ts
   type ExpectedKeys = 'defaultCommissionRate' | 'defaultCommissionDetails' | /* …24… */;
   type AssertExact<T extends Record<ExpectedKeys, unknown>> =
     Exclude<keyof T, ExpectedKeys> extends never ? true : never;
   const _typeCheck: AssertExact<BecomeSellerOptions> = true;
   ```
   Esto SÍ falla en ambas direcciones (clave de más o de menos), y no
   depende de `satisfies` (bien, porque **`satisfies` no existe en este
   repo** — `typescript: ^4.7.4` en `apps/api/rest/package.json`, y
   `satisfies` llegó en TS 4.9. Riesgo a anotar para `sdd-design`: no usar
   `satisfies` en ningún ejemplo de código de la US.)
2. O un literal de objeto escrito a mano con las 24 claves explícitas
   (verboso, pero si se prefiere legibilidad sobre elegancia de tipos es
   una alternativa válida).

El chequeo en runtime (`Object.keys(dto.page_options)` con `toHaveLength(24)` /
`toEqual([...24 nombres...])`) sigue siendo necesario de todos modos
porque cubre el caso "la clave existe en el tipo pero el servicio no la
usa" — pero por sí solo NO es la red "a compilación" que CA-3 pide; hay
que combinar ambos. Y sea cual sea el diseño, el DoD exige **demostrarlo
empíricamente** (romper `commissions`→`missions` a propósito, pegar el
error real de TypeScript, restaurar) — la investigación de arriba no
sustituye esa evidencia, solo evita que el agente elija una técnica que
parezca un test pero no proteja nada.

## 5. Baselines medidos hoy, sin tocar nada

El entorno YA tenía la API (`:9001`) y Postgres (`safari-postgres`,
puerto 5433) corriendo de una sesión anterior — no se arrancó nada para
esta exploración, solo se consultó lo que ya estaba arriba.

- `cd apps/api/rest && npx jest` → **10 suites / 290 tests, verde**
  (268.7s). Confirma la línea base del US al pie de la letra.
- `just db-check` → **12 archivos / 228 tests, verde** (54.6s). Esta US
  no toca `packages/db`; esta cifra debe seguir igual después.
- `just build-api` → **verde** (170.4s). Con esto ya se pudo inspeccionar
  `dist/` real, no solo teorizar sobre el plugin.
- `GET http://localhost:9001/api/became-seller` → `HTTP 200`, **11452 B**
  — coincide EXACTO con la cifra que el US fija para CA-4. Cuerpo capturado
  (fuera del repo, en el scratchpad de esta sesión) por si sirve de
  referencia, aunque a la hora de aplicar el cambio el DoD exige una
  captura fresca "antes de tocar nada" — la de hoy es solo evidencia de
  que la cifra del US es real, no el snapshot oficial de CA-4.
- `GET http://localhost:9001/api/settings` → `HTTP 200`,
  `Content-Length: 5504` (coincide con la nota de `CLAUDE.md`: 5503 es
  `body.length`, 5504 es el header por el `©` multibyte).
- `GET http://localhost:9001/docs-json` → `HTTP 200`, **170326 B** — cifra
  exacta que el US cita como "antes". Extraído con `node -e`:
  - `paths['/api/became-seller'].post.requestBody` → props
    `['id','page_options','language','missions']`, `required` igual a esas
    4 (con `id` y `language` incluidos — el defecto que CA-2 corrige).
  - `page_options` interno (`BecomeSellerOptions`) → exactamente 12 props.
  - `banner` → `$ref BecomeSeller Attachment` → props
    `['thumbnail','original','id','created_at','updated_at']` (sin
    `file_name`, sin las 9 reales).
  - `get.responses.200` → props top-level
    `['page_options','language','missions','id','created_at','updated_at']`
    (el envoltorio mal aplanado).
  - `BecomeSeller.properties.missions` → `{"type":"array","items":{"type":"object"}}`
    — confirma el hallazgo de §1 (no hay `$ref CommissionItem`; no existe
    ese schema en `components.schemas`).

No se pudo ni se debió arrancar nada para esta exploración: si en una
sesión futura la API/Postgres NO están arriba, la evidencia de CA-2/CA-4
requiere `just api-dev` + `just db-up` (o confirmar que ya están arriba
como hoy) antes de repetir estos `curl`/`node -e`.

## 6. Riesgos a decidir antes o durante `sdd-design`

1. **`CommissionItem` debe pasar de `interface` a `class`.** Sin esto,
   Swagger nunca mostrará `max_balance` como `type: "string"` (§1) —
   bloquea CA-2 aunque el resto de la entidad esté perfecto. No está en
   la tabla de cambios del US de forma explícita (dice "clase propia para
   banner, Showcase/GuidelineItem/UserStory/Contact" pero no menciona
   `CommissionItem` por nombre); es una consecuencia necesaria, hay que
   incluirla.
2. **`max_balance: string` vs `string | number`.** CA-2 dice literalmente
   `max_balance es type: "string"` (singular, sin `oneOf`). Si el agente
   elige `string | number` (que la nota del US deja abierto), el plugin
   de `@nestjs/swagger` típicamente serializa una unión de tipos
   primitivos como `{oneOf: [{type:'string'},{type:'number'}]}`, NO como
   `{type:'string'}` — eso **incumpliría CA-2 literalmente** aunque sea
   una decisión "razonable" de negocio. Recomendación: declarar
   `max_balance: string` a secas (lo que hay persistido, lo que exige
   CA-2) y anotar en el reporte que el 0 por defecto del formulario del
   admin es una discrepancia ya conocida y fuera de este scope (no se
   toca el admin).
3. **Nulabilidad de `guidelineItems[].link`.** El plugin de Swagger no
   marca automáticamente `string | null` como `nullable: true` en el
   schema por simple inferencia de tipos TS (es una limitación conocida
   del plugin de `@nestjs/swagger` con tipos unión); puede requerir
   `@ApiProperty({ nullable: true })` en ese campo puntual. Esto NO es
   "añadir validadores de `class-validator`" (prohibido por el scope) —
   es un decorador de documentación de Swagger, categoría distinta y
   dentro de lo que el módulo necesita para describir el contrato real.
   Verificar en `/docs-json` tras el cambio; si el plugin ya lo infiere
   solo, no hace falta el decorador.
4. **El comentario de `become-seller.service.ts:12-23` contiene la
   subcadena literal `as unknown as` en la prosa** (documentando la
   deuda). El grep de verificación de CA-3
   (`grep -n "as unknown as\|..." become-seller.service.ts`) coincide con
   CUALQUIER aparición del string, incluida en comentarios. Al reescribir
   el comentario para describir el estado corregido, hay que evitar
   repetir esa frase literal (aunque sea en pasado/negado) o el propio
   grep de cierre dará un falso positivo.
5. **Contrato HTTP y orden de claves.** El servicio ya recompone el
   envoltorio con un literal de orden fijo (D-2 archivado); mientras la
   nueva `BecomeSeller`/`_toEnvelope()` conserven ese mismo orden literal
   de construcción, los 11452 B y el `deepStrictEqual` de CA-4 no deberían
   moverse — pero es el `service.ts` el que decide el orden en runtime,
   no la clase de TypeScript (que no tiene orden de ejecución); no hay
   riesgo aquí más allá de no tocar el orden de las claves en el literal
   de `_toEnvelope()`.
6. **`Attachment` sin `file_name`** (mencionado en §2) es una divergencia
   heredada, ya señalada como "mejora adyacente no accionada" por el US
   mismo — no se acciona, solo se repite aquí porque afecta directamente
   a cómo se tipan `banner.image`, `dashboard.image`,
   `sellerOpportunity.image`, `userStories[].thumbnail`,
   `commissions[].image`.
7. **`just build-api` como gate real.** Confirmado hoy en 170s de verde;
   cualquier tipo que el plugin no sepa serializar (p. ej. una unión
   compleja, un genérico) rompe el build, no solo `/docs`. Presupuestar
   tiempo para este gate en `sdd-apply` (no es instantáneo).

## Mejoras adyacentes mencionadas, no accionadas (recordatorio, no se tocan)

- `settings.service.ts:39` — mismo patrón de `as unknown as Setting`.
- `common/entities/attachment.entity.ts` sin `file_name`.
- `apps/shop/src/types/index.ts:1232-1237` — campo `commission` (singular).
- `apps/admin/rest/src/types/index.ts:2123` (`max_balance: number`) y
  `:2196` (`thumbnail: string`) — el tipo del admin discrepa del dato real.
- Si hicieran falta validadores de `class-validator` en el DTO: no se
  evaluó a fondo (fuera de scope), pero dado que `ValidationPipe` corre
  sin `whitelist`/`transform` (main.ts:9), añadirlos hoy no cambiaría el
  comportamiento en runtime salvo que también se active `transform`.

## Ready for Proposal

**Sí.** El terreno está completamente verificado (cero drift), la forma
del payload está fijada con evidencia de `node -e`, hay una recomendación
concreta de diseño (Opción A) con su justificación, se identificó un
bloqueador no citado por el US (`CommissionItem` debe ser clase) y una
tensión real entre la nota abierta del US sobre `max_balance` y la
literalidad de CA-2. `sdd-propose`/`sdd-design` pueden partir de aquí sin
re-investigar.
