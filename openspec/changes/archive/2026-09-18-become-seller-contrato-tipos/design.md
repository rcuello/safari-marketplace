# Design: entidad y DTO de `become-seller` alineados con el contrato real (US-45)

> Entradas: `proposal.md` (D-1..D-5 fijadas, D-6 abierta), `specs/become-seller-contract-types/spec.md`
> (R1..R5), `exploration.md` (cero drift contra `main` `f50b145`).
> Todo lo que este documento afirma sobre TypeScript se **comprobó compilando**
> con el `tsc` del propio repo (`apps/api/rest/node_modules/.bin/tsc`,
> `typescript@4.7.4`) sobre una maqueta con las opciones de
> `apps/api/rest/tsconfig.json`; todo lo que afirma sobre OpenAPI se leyó del
> `/docs-json` vivo (170326 B, misma cifra que la exploración).

## Technical Approach

Opción A del proposal (D-1): las clases del objeto interno viven en
`entities/become-seller.entity.ts` y el DTO las importa. Sobre esa base, el
diseño cierra seis puntos que el proposal dejó abiertos o no vio:

1. **D-6** (imagen) → clase local `BecomeSellerImage` de 4 claves.
2. **D-7** (nulabilidad) → un único `@ApiProperty({ type: String, nullable: true })`.
3. **D-8** (**hallazgo nuevo, bloqueante**) → el límite `jsonb` no se puede
   cruzar sin escape *salvo* con guardas de tipo; es lo que sustituye a los dos
   `as` que CA-3 prohíbe.
4. **D-9** (**hallazgo nuevo**) → `Banner` ya existe como schema global; hay que
   renombrar o se corrompe la documentación de `/api/types`.
5. **D-10** → forma concreta de la red de CA-3 (D-4), con rojo/verde ya medidos.
6. **D-11** → el spec deja de castear construyendo sus fixtures desde el JSON real.

## Architecture Decisions

### D-6 — Las imágenes se tipan con una clase local de 4 claves, no con `Attachment`

**Elección**: `BecomeSellerImage { thumbnail: string; original: string; id: number; file_name: string }`,
declarada en `become-seller.entity.ts`, **sin** heredar de `Attachment`. La usan
los seis campos con forma de imagen del módulo: `banner.image`,
`dashboard.image`, `sellerOpportunity.image`, `sellingStepsItem[].image`,
`userStories[].thumbnail` y `commissions[].image` — verificado con `node -e`:
los seis traen **exactamente** esas 4 claves, en ese orden, sin excepción.

**Alternativa rechazada**: reutilizar `Attachment`. No es solo que le falte
`file_name`: `Attachment extends CoreEntity`, y `/docs-json` publica hoy
`Attachment.required = ["id","created_at","updated_at"]`. Reutilizarla
**inventaría dos campos obligatorios que el dato no tiene** (`created_at`,
`updated_at` no existen en ninguna de las seis imágenes) además de ocultar
`file_name`. Contra R1 ("tipado honesto") eso es peor que el defecto que la US
viene a corregir.

**Coste, explícito**: se duplica un concepto compartido — el repo pasa a tener
dos clases con forma de adjunto. Es deuda registrada, no accionada
(`attachment.entity.ts` sin `file_name` ya figura como deuda adyacente en la US
y en `exploration.md §6.6`). Si algún día `Attachment` gana `file_name` y pierde
los timestamps obligatorios, esta clase debe reconciliarse con ella. Ningún
camino toca `attachment.entity.ts`, como exige el "NO incluye".

### D-7 — `guidelineItems[].link`: el decorador de documentación es obligatorio

**Elección**: `@ApiProperty({ type: String, nullable: true })` sobre esa única
propiedad. Es el **único** decorador que se añade en todo el change.

**Por qué no basta el plugin**: `apps/api/rest/tsconfig.json` **no activa
`strict` ni `strictNullChecks`**. Sin `strictNullChecks`, el comprobador reduce
`string | null` a `string` antes de que el plugin lo lea: `nullable: true` no
puede inferirse ni por accidente. No es una duda, es una consecuencia de la
configuración. Y el dato sí trae `guidelineItems[4].link === null`, así que sin
el decorador el documento publicaría un contrato falso — justo lo que R2 viene a
arreglar.

**Por qué NO es un validador** (la distinción que un revisor debe poder ver sin
re-derivarla):

| | `@ApiProperty` (`@nestjs/swagger`) | `@IsString()` etc. (`class-validator`) |
|---|---|---|
| Quién lo lee | `SwaggerModule.createDocument()`, una vez en el arranque (`main.ts:16-17`) | `ValidationPipe` en **cada** petición (`main.ts:9`) |
| Dónde guarda metadata | `swagger/*` de `Reflect` | `MetadataStorage` de `class-validator` |
| Puede rechazar una petición | **No.** No participa en el pipe | Sí: 400 |
| Dependencia nueva | Ninguna: el DTO ya importa de `@nestjs/swagger` (`OmitType`) | Sí, en este módulo |

`new ValidationPipe()` corre sin `whitelist` ni `transform`, y no lee metadata de
Swagger bajo ninguna configuración. El decorador es inerte en runtime por
construcción.

**Cómo se verifica que surtió efecto**: no se ve bajo `ts-jest` (el plugin CLI
solo corre en el build de Nest). Secuencia obligatoria en apply:
`just build-api` → API levantada → `curl /docs-json` → seguir
`get.responses.200.$ref` → `BecomeSellerOptions.properties.guidelineItems.items.$ref`
→ comprobar `properties.link.nullable === true`. **Contingencia acotada**: si el
plugin lo ignora o pisa el `type`, ninguna CA depende de `nullable` (R2 no lo
pide); se retira el decorador y se registra la divergencia en el reporte. No se
inventa una segunda vía.

### D-8 — El límite `jsonb` se cruza con guardas de tipo (`unknown` → `value is T`)

**El hallazgo**: `@safari/db` devuelve `pageOptions`/`commissions` como
`Prisma.JsonValue` y acepta `Prisma.InputJsonValue` (`packages/db/src/records.ts:187-194`,
`become-seller.repository.ts:19-24`). Ninguna clase es asignable a esos tipos, en
ninguna dirección. Compilado, no razonado:

```
error TS2322: Type 'Opts' is not assignable to type 'InputJsonValue'.
  Type 'Opts' is not assignable to type 'InputJsonObject'.
    Index signature for type 'string' is missing in type 'Opts'.
error TS2322: Type 'JsonValue' is not assignable to type 'Opts'.
```

TypeScript concede índice implícito a los alias de tipo, **no a clases ni
interfaces** — y las clases son obligatorias para el plugin de Swagger (D-2).
El `{ ...spread }` tampoco sirve: falla un nivel más abajo, donde
`banner: BecomeSellerBanner` vuelve a ser una clase. **Esta es la razón real por
la que US-44 puso los dos `as unknown as`**, y el proposal no la contempla: sin
resolverla, CA-3 es inalcanzable.

**Elección**: cuatro guardas de tipo a nivel de módulo en
`become-seller.service.ts`, con el parámetro declarado `unknown` (con `unknown`
el predicado es legal siempre; con `Prisma.JsonValue` daría TS2677 "a type
predicate's type must be assignable to its parameter's type"):

```ts
function _isBecomeSellerOptions(value: unknown): value is BecomeSellerOptions { … }
function _isCommissionList(value: unknown): value is CommissionItem[] { … }
function _isJsonObject(value: unknown): value is Prisma.InputJsonObject { … }
function _isJsonArray(value: unknown): value is Prisma.InputJsonArray { … }
```

Cuerpo: `typeof value === 'object' && value !== null && !Array.isArray(value)`
(objeto) / `Array.isArray(value)` (array). **Maqueta compilada en verde con las
cuatro guardas, el literal de `_toEnvelope()` sin un solo `as` y `create()`
leyendo el DTO tipado.**

**Alternativas rechazadas**: `JSON.parse(JSON.stringify(x))` (devuelve `any`, no
necesita `as`, pero clona ~11 KB por petición y rompe la identidad que el spec
afirma con `toBe`); `Object.assign(new BecomeSellerOptions(), …)` (compila, pero
copia en runtime solo para contentar al comprobador); índice de string en las
clases (destruiría la red de CA-3: `keyof T` pasaría a `string | number`); un
`toJSON()` en cada clase (mentira: en runtime los objetos son JSON plano, nunca
instancias).

**Coste, explícito, y matiz al rollback del proposal**: las guardas son código
en runtime, así que el change **no es 100 % inerte**, como decía el proposal.
Dos efectos, ambos acotados:

- *Lectura* (`_toEnvelope`): una segunda guarda con su propio mensaje, en la
  misma familia que la de fila ausente que ya existe. Inalcanzable con la fila
  sembrada (`page_options` es `jsonb` con objeto y `commissions` con array).
- *Escritura* (`create`): la guarda **sustituye** al `!== undefined` del spread
  condicional (`...(_isJsonObject(dto.page_options) && { pageOptions: … })`; el
  estrechamiento se propaga dentro del `&&`, comprobado). Para un body válido el
  comportamiento es idéntico. Única divergencia: un body con
  `page_options: "texto"` o `null` hoy se reenvía a Prisma (y corrompe la fila o
  revienta); con la guarda **se omite la clave**. No se rechaza nada, no aparece
  ningún 4xx nuevo, no se añade `class-validator`. Es el reverso en runtime del
  estrechamiento, no validación de negocio.

### D-9 — `Banner` colisiona en `components.schemas`: prefijo `BecomeSeller` para lo nuevo

**Hallazgo verificado contra `/docs-json` vivo**: `types/entities/type.entity.ts:16`
ya exporta `class Banner`, publicada como `#/components/schemas/Banner` y
referenciada por `Type.banners`. `components.schemas` es un **espacio plano de
185 nombres**: declarar un segundo `Banner` haría que uno pise al otro en
silencio y rompería la documentación de `/api/types` — una regresión **fuera**
del módulo aunque el diff siga dentro de él.

**Elección**: toda clase que este change **introduce** lleva prefijo
`BecomeSeller`; las que ya existen conservan su nombre (cero churn de schemas ya
publicados). Nombres comprobados como libres hoy: `BecomeSellerImage`,
`BecomeSellerBanner`, `BecomeSellerShowcase`, `BecomeSellerGuidelineItem`,
`BecomeSellerUserStory`, `BecomeSellerContact`, `BecomeSellerEnvelope`,
`CommissionItem`. R2 bendice el renombre de forma explícita: los `$ref` se
resuelven desde `paths['/api/became-seller']`, "nunca por nombre de schema fijo".

### D-10 — Red de CA-3: `keyof`/`Exclude` derivado del JSON + `Object.keys` en runtime

**Elección** (vive en `become-seller.service.spec.ts`; `tsconfig.build.json`
excluye `**/*spec.ts`, así que el rojo lo da `npx jest` vía `ts-jest` sin
`isolatedModules`, tal como pide R4):

```ts
import becomeSellerJson from '@db/become-seller.json';

type KeyDrift<T, K extends string> = Exclude<keyof T, K> | Exclude<K, keyof T>;
type AssertSameKeys<T, K extends string> =
  [KeyDrift<T, K>] extends [never] ? true : KeyDrift<T, K>;

const _topLevelKeys: AssertSameKeys<BecomeSeller, keyof typeof becomeSellerJson> = true;
const _envelopeKeys: AssertSameKeys<BecomeSellerEnvelope, keyof typeof becomeSellerJson.page_options> = true;
const _optionKeys: AssertSameKeys<BecomeSellerOptions, keyof typeof becomeSellerJson.page_options.page_options> = true;
const _dtoKeys: AssertSameKeys<CreateBecomeSellerDto, 'language' | 'page_options' | 'commissions'> = true;
```

Las 24 claves **no se escriben a mano en el tipo**: se derivan del dato
(`keyof typeof`), que es la fuente de verdad del contrato. El corchete
`[X] extends [never]` evita la distribución de condicionales sobre `never`. Sin
`satisfies` (TS 4.7.4). La rama falsa devuelve la unión de claves a la deriva,
así que **el error nombra la clave culpable**. Rojo/verde ya medidos en la
maqueta:

| Sabotaje | Salida real de `tsc` |
|---|---|
| Quitar `contact` de `BecomeSellerOptions` | `error TS2322: Type 'true' is not assignable to type '"contact"'.` |
| Añadir `contacto` (typo) | `error TS2322: Type 'true' is not assignable to type '"contacto"'.` |
| `commissions` → `missions` en el DTO | `error TS2322: Type 'true' is not assignable to type 'KeyDrift<Dto, "page_options" \| "commissions" \| "language">'.` |
| Restaurar | `EXIT=0` |

`@db/become-seller.json` resuelve al mock real por `moduleNameMapper`
(`^@db/(.*)$` → `<rootDir>/db/pickbazar/$1`, `rootDir: "src"`) y por `paths` en
`tsconfig.json`; `resolveJsonModule` y `esModuleInterop` están activos. Los
cuatro `const` compilaron en verde importando el JSON real.

**Segunda dirección, complementaria**: asignar el JSON real al DTO tipado (D-11)
**sí** detecta deriva de *tipo* (no de claves). Comprobado: declarar
`max_balance: number` produce
`error TS2322: … Types of property 'max_balance' are incompatible. Type 'string' is not assignable to type 'number'.`
Claves ← `AssertSameKeys`; tipos ← la asignación; presencia en el dato ←
`Object.keys(...)` en runtime con la lista de 24 nombres escrita una sola vez,
como `it()` normal (`toHaveLength(24)` + `toEqual([...])`).

**Demostración exigida por el DoD en apply**: `npx jest` verde → romper
`commissions`→`missions` en `create-become-seller.dto.ts` → `npx jest` y pegar el
`error TS2322` real → restaurar → `npx jest` verde. Ambas salidas al reporte.

### D-11 — El spec construye sus fixtures desde el JSON real (fuera el cast)

`createDto()` (`:54-58`) desaparece. Los tests de `create()` pasan
`{ language: json.page_options.language, page_options: json.page_options.page_options, commissions: json.commissions }`:
**compila sin cast** (comprobado). Los tests de `findAll()` no cambian de
fixture: `makeRecord()` sigue tipado `BecomeSellerRecord`, cuyos campos son
`Prisma.JsonValue`, así que sus objetos parciales siguen siendo válidos y pasan
las guardas de D-8. Lo que sí desaparece de esos tests son los `as never as`
(`:75-87`): con `BecomeSeller` bien tipada, `result.page_options.page_options` se
lee directo.

### D-12 — `update-become-seller.dto.ts` y los métodos muertos

`PartialType(CreateBecomeSellerDto)` se corrige solo al corregirse su base: cero
líneas de diff, solo se verifica que compila (`just build-api`). Los métodos
`update`/`findOne`/`remove` (`:59-72`) **se conservan intactos** (D-6 de US-44);
`update()` sigue consumiendo `UpdateBecomeSellerDto` sin cambios.

### Decisiones heredadas del proposal, sin reinterpretar

D-1 (Opción A), D-2 (`CommissionItem` pasa a `class` — confirmado: no existe
`CommissionItem` en los 185 schemas de hoy), D-3 (`max_balance: string`),
D-4 (mecanismo, concretado en D-10) y D-5 (comentario reescrito).

## Data Flow

```
GET  /api/became-seller                    POST /api/became-seller
        │                                          │  body = BecomeSellerInput (admin)
        ▼                                          ▼
 controller.findAll()                       controller.create(@Body() CreateBecomeSellerDto)
        │                                          │   ValidationPipe: sin decoradores -> pasa tal cual
        ▼                                          ▼
 service.findAll()                          service.create(dto)
        │                                          │  _isJsonObject / _isJsonArray  (D-8, escritura)
        │                                          ▼
        │                                   updateBecomeSeller({pageOptions, commissions, language})
        ▼                                          │
 getBecomeSeller() ──── BecomeSellerRecord ◄───────┘   (pageOptions/commissions: Prisma.JsonValue)
        │
        ▼  _toEnvelope(row)
   _isBecomeSellerOptions(row.pageOptions) && _isCommissionList(row.commissions)   (D-8, lectura)
        │
        ▼  literal de orden fijo, SIN cast  ->  BecomeSeller  (11 452 B, sin cambios)

become-seller.entity.ts ──(clases compartidas)──> create-become-seller.dto.ts ──> update-…dto.ts
        └──────────── @db/become-seller.json ────────────> spec: AssertSameKeys + Object.keys
```

## File Changes

| Archivo (`apps/api/rest/src/become-seller/`) | Acción | Descripción |
|---|---|---|
| `entities/become-seller.entity.ts` | Modify (reescritura) | 13 clases; envoltorio real; `CommissionItem` a `class`; un `@ApiProperty` |
| `dto/create-become-seller.dto.ts` | Modify | 3 propiedades a mano; fuera `OmitType`; importa 2 clases de la entidad |
| `become-seller.service.ts` | Modify | Fuera `BecomeSellerWriteBody` y los 2 `as`; 4 guardas; comentario D-5 |
| `become-seller.service.spec.ts` | Modify | Fuera `createDto()` y los `as never as`; red de D-10 |
| `dto/update-become-seller.dto.ts` | Sin cambio | Se verifica que compila |
| Cualquier cosa fuera del directorio | **Sin tocar** | `git diff --stat` acotado (R5) |

## Interfaces / Contracts

Inventario completo, en orden de declaración (dependencias primero). Un solo
archivo: `entities/become-seller.entity.ts`.

| # | Clase | Estado | Claves | Notas |
|---|---|---|---|---|
| 1 | `BecomeSellerImage` | nueva | `thumbnail, original, id, file_name` | D-6; la usan 6 campos |
| 2 | `BecomeSellerBanner` | nueva | 9: `newsTickerTitle, newsTickerURL, title, description, button1Name, button1Link, button2Name, button2Link, image` | D-9; sustituye a `banner: Attachment` |
| 3 | `BecomeSellerShowcase` | nueva | 7: `title, description, buttonName, buttonLink, button2Name, button2Link, image` | `dashboard` y `sellerOpportunity` |
| 4 | `SellingStepItem` | existe, modificada | `title, description, image` | fuera `id?`; `image` obligatoria y `BecomeSellerImage` |
| 5 | `BusinessPurposeItem` | existe, modificada | `description, title, icon: { value: string }` | fuera `id?`; `icon` inline (el plugin lo serializa bien, verificado) |
| 6 | `BecomeSellerGuidelineItem` | nueva | `title, link: string \| null` | único `@ApiProperty` (D-7) |
| 7 | `FaqItems` | existe, sin cambio de forma | `title, description` | solo se alinea el orden al dato |
| 8 | `BecomeSellerUserStory` | nueva | `title, description, link, thumbnail: BecomeSellerImage` | `thumbnail` objeto, no string |
| 9 | `BecomeSellerContact` | nueva | `title, description` | |
| 10 | `CommissionItem` | `interface` → `class` | 11: `id, level, sub_level, description, min_balance, max_balance, commission, image, language, created_at, updated_at` | D-2; `max_balance: string` (D-3); `created_at`/`updated_at` **`string`**, NO `Date`: en el JSON de `commissions` son texto. **No** extiende `CoreEntity` |
| 11 | `BecomeSellerOptions` | existe, 12 → 24 claves | las 24 en el orden del dato | |
| 12 | `BecomeSellerEnvelope` | nueva | `extends CoreEntity` + `page_options: BecomeSellerOptions` + `language` | `/docs-json` de hoy demuestra que Nest **aplana** la herencia (no hay schema `CoreEntity`): saldrán 5 props planas, como pide R2 |
| 13 | `BecomeSeller` | existe, reescrita | `page_options: BecomeSellerEnvelope`, `commissions: CommissionItem[]` | ya no extiende `CoreEntity` |

```ts
// dto/create-become-seller.dto.ts  (sin OmitType)
import { BecomeSellerOptions, CommissionItem } from '../entities/become-seller.entity';

export class CreateBecomeSellerDto {
  language?: string;
  page_options: BecomeSellerOptions;
  commissions: CommissionItem[];
}
```

Coincide 1:1 con `BecomeSellerInput` del admin
(`apps/admin/rest/src/types/index.ts:2242-2246`), verificado.

**Divergencias conscientes** (mencionadas, no accionadas): el tipo del admin
marca opcionales `newsTickerTitle`, `button1Name/Link`, `button2Name/Link`,
`defaultCommissionDetails`, `userStoryDescription` y `link`; el dato los trae
todos. Regla de la US — **gana el dato** —, y son una sola clase compartida por
GET y POST, así que se declaran obligatorios. Sin efecto en runtime (no hay
validación); solo endurece la lista `required` del documento, que ninguna CA fija
para el objeto interno.

**Comentario de `become-seller.service.ts:12-23` reescrito** (D-5 — sin la
subcadena prohibida en ningún tiempo verbal ni negada): documenta el límite
`jsonb`, que `Prisma.JsonValue`/`InputJsonValue` no se relacionan por subtipado
con una clase porque a una clase le falta el índice de string, que por eso las
cuatro guardas estrechan con una comprobación real de runtime, y que `create()`
lee `page_options`/`commissions`/`language` directamente del DTO tipado. El
`grep` de cierre de CA-3 debe salir vacío sobre el archivo completo.

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Tipos (compilación) | Claves del envoltorio, del objeto interno (24) y del DTO, en ambas direcciones | `AssertSameKeys` derivado del JSON (D-10); rojo/verde demostrado |
| Tipos (compilación) | Tipo de cada campo (`max_balance` string, `thumbnail` objeto) | Asignación del JSON real al DTO tipado, sin cast (D-11) |
| Unidad (`npx jest`) | Envoltorio de 2+5 claves, delegación del POST, 500 sin fila, spread condicional | 5 `it()` existentes, fixtures desde el JSON real |
| Unidad (`npx jest`) | El dato real sigue teniendo 24 claves con esos nombres | `Object.keys(json.page_options.page_options)` + lista literal |
| Documento | `requestBody`/`responses` por `$ref`, 24 props, `banner` con 9 sin `Attachment`, `max_balance` `type: "string"`, `link.nullable` | `just build-api` + `curl /docs-json` + `node -e` (sin `jq`) |
| Contrato HTTP | `GET` 11 452 B + `deepStrictEqual` (excluyendo timestamps del envoltorio), `POST` 201, `/api/settings` 5503 B | captura **fresca** antes de tocar nada; `just verify` |
| No regresión | `npx jest` ≥ 10 suites / ≥ 291; `just db-check` exactamente 12/228 | base medida: 10/290 y 12/228 |

## Migration / Rollout

No hay migración: ni DDL, ni seed, ni datos, ni contrato HTTP, ni cliente.
`db/schema.sql`, `db/seed.sql` y `packages/db` quedan intactos.

**Rollback** — `git revert <commit>` (o `git checkout -- apps/api/rest/src/become-seller/`):
un directorio, cuatro archivos tocados. Después `just build-api` (regenera
`dist/` y el documento Swagger) y `npx jest` para confirmar la base. El change es
de **compilación y de documentación OpenAPI**; `new ValidationPipe()` corre sin
opciones y ni la entidad ni el DTO llevan decoradores de `class-validator`, así
que no puede alterar el manejo de una petición válida. La **única** huella en
runtime son las guardas de D-8, cuyo alcance queda descrito allí (bodies
malformados: clave omitida en vez de reenviada; jamás un 4xx nuevo). Si un
`POST` de prueba editó la fila 1, se restaura con el patrón de US-44 CA-2.

## Previsión de tamaño (por archivo)

| Archivo | Inserciones | Borrados | Cambiadas |
|---|---|---|---|
| `entities/become-seller.entity.ts` | ~135 | 55 | ~190 |
| `become-seller.service.spec.ts` | ~60 | ~20 | ~80 |
| `become-seller.service.ts` | ~40 | ~32 | ~72 |
| `dto/create-become-seller.dto.ts` | ~15 | 7 | ~22 |
| **Total** | **~250** | **~114** | **~364** |

**Corrección honesta al proposal**: su horquilla de ~230-260 contaba el tamaño
final de la entidad (55 → 120), no `insertions + deletions` de una reescritura
completa, que es la métrica del presupuesto de 400. La causa **no** es la que el
proposal anticipaba (duplicar clases entre entidad y DTO): las clases se declaran
una sola vez y el DTO las importa. El exceso sale de D-8 (~12 líneas de guardas
+ comentario) y de una entidad de 13 clases a una propiedad por línea.

- `400-line budget risk: Medium` (~364 de 400; margen ~36 líneas).
- `Chained PRs recommended: No`. `single-pr` se mantiene: es una única corrección
  atómica de contrato y la red del spec es la evidencia de CA-3 del propio DoD.
- Palanca si el conteo se pasa de 400 en apply: la masa comprimible es la prosa
  de comentarios de la entidad. Partir el change dejaría `main` con una entidad
  correcta y un servicio que aún no compila — peor.

## Open Questions

- [ ] Ninguna bloqueante. Único punto no verificable sin construir: si el plugin
      emite `nullable: true` con el decorador de D-7 (contingencia acotada ya
      definida allí).
