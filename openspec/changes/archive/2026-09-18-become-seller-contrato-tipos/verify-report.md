# Verification Report — become-seller-contrato-tipos (US-45)

**Change**: `become-seller-contrato-tipos`
**Capability**: `become-seller-contract-types` (nueva; `become-seller-page-api`
no se modifica, solo se re-verifica)
**Modo**: Standard (`strict_tdd: false`)
**Fecha de verificación**: 2026-09-18
**Rama**: `us-45-become-seller-contrato-tipos` (trabajo SIN commitear, en el
working tree — no se commiteó, pusheó ni stasheó nada en esta fase)
**`artifact_store_mode`**: `openspec` (Engram NO conectado; no se invocó
ninguna herramienta de Engram)

**Veredicto global: PASS WITH WARNINGS.** Los 5 requirements y los 4 CA se
cumplen con evidencia de ejecución real. Las advertencias son de precisión
(la solidez residual de los predicados, una frase sobre-amplia del
disclosure y tres puntos de propiedad del owner), ninguna bloquea el
archivado.

---

## 0. Procedencia de la evidencia

Esta fase re-derivó por su cuenta casi toda la evidencia. Lo que se lleva
de fases anteriores está marcado explícitamente.

**Re-derivado en esta verificación** (comandos corridos aquí):

- Los tres greps de cierre (módulo completo, no solo el servicio).
- `git diff --stat` acotado y global.
- La forma real del payload desde
  `apps/api/rest/src/db/pickbazar/become-seller.json`, incluida la
  uniformidad de TODOS los elementos de cada array (no solo `[0]`).
- El documento `/docs-json` en vivo, resuelto por `$ref` desde
  `paths['/api/became-seller']`, más el chequeo colateral D-9.
- La prueba de frescura del documento (ver §2.1) — método propio, no el
  del ejecutor.
- `GET /api/became-seller` en vivo: 11 452 B y `deepStrictEqual` contra
  `antes.json` **y** contra el mock versionado.
- La matriz rojo/verde de la red de tipos (R4), sobre COPIAS en el
  scratchpad, con el `tsc` real del repo (4.9.5). No se saboteó ningún
  archivo del repo.
- `npx jest`, `just db-check`, `just build-api`, `just verify`.
- El comportamiento de las dos guardas sobre entradas malformadas.

**Llevado de fases anteriores (no re-derivable aquí sin revertir o mutar
datos), marcado como tal donde aparece**:

- El `/docs-json` **anterior** al cambio (`docs-antes.json`, artefacto del
  ejecutor). Se inspeccionó su contenido aquí y además se corroboró de
  forma independiente contra `git show HEAD:...become-seller.entity.ts`
  y `...create-become-seller.dto.ts`.
- El `POST` con el body real del admin → 201 y la restauración por `psql`
  (no se re-ejecutó para no mutar la fila; el `deepStrictEqual` COMPLETO
  —incluidos timestamps— que sí se re-corrió aquí demuestra que la fila
  quedó restaurada).
- La demostración en vivo del exploit cerrado (lote correctivo).
- La línea base de 290 tests previa al cambio.

---

## 1. Completeness

| Métrica | Valor |
|---|---|
| Tareas totales (`tasks.md`) | 40 (32 originales + 8 de la Fase 7 correctiva) |
| Tareas completas `[x]` | 40 |
| Tareas incompletas `[ ]` | 0 |

```
$ grep -c '^- \[x\]' openspec/changes/become-seller-contrato-tipos/tasks.md
40
$ grep -c '^- \[ \]' openspec/changes/become-seller-contrato-tipos/tasks.md
0
```

Las 8 tareas C.1-C.8 de `apply-progress.md` son las mismas 7.1-7.8 de
`tasks.md`; no hay doble conteo.

---

## 2. Requirements

### R1 — La entidad y el DTO describen el payload real (CA-1) → **MET**

Ground truth leído aquí del JSON versionado:

```
top-level keys: [ 'page_options', 'commissions' ]
envelope keys: [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ]
inner count: 24
inner keys: ["defaultCommissionRate","defaultCommissionDetails","banner","sellingStepsTitle","sellingStepsDescription","sellingStepsItem","userStoryTitle","userStoryDescription","purposeTitle","purposeDescription","purposeItems","commissionTitle","commissionDescription","isMultiCommissionRate","dashboard","guidelineTitle","guidelineDescription","guidelineItems","faqTitle","faqDescription","faqItems","contact","sellerOpportunity","userStories"]
banner keys(9): ["newsTickerTitle","newsTickerURL","title","description","button1Name","button1Link","button2Name","button2Link","image"]
max_balance tiers: [ [ 'string', '3000' ], [ 'string', '1000' ] ]
commissions[0] keys: ["id","level","sub_level","description","min_balance","max_balance","commission","image","language","created_at","updated_at"]
commissions[0].id typeof: number 79
guidelineItems links: [ ...4 URLs..., null, ...3 URLs... ]
userStories[0].thumbnail typeof: object ["thumbnail","original","id","file_name"]
```

Uniformidad comprobada sobre TODOS los elementos, no solo el primero
(una sola variante de claves por colección):

```
sellingStepsItem variantes de claves: [ '["title","description","image"]' ]
purposeItems variantes de claves: [ '["description","title","icon"]' ]
guidelineItems variantes de claves: [ '["title","link"]' ]
faqItems variantes de claves: [ '["title","description"]' ]
userStories variantes de claves: [ '["title","description","link","thumbnail"]' ]
commissions variantes de claves: [ '["id","level",...,"updated_at"]' ]
purposeItems[].icon variantes de claves: [ '["value"]' ]
todas las imagenes variantes de claves: [ '["thumbnail","original","id","file_name"]' ]
```

Contraste con `become-seller.entity.ts` (leído línea a línea):

| MUST del spec | Estado | Dónde |
|---|---|---|
| Top-level exactamente `page_options`/`commissions` | ✅ | `BecomeSeller` (`:137-140`) |
| Envoltorio en 5 claves (`id`, `page_options`, `language`, `created_at`, `updated_at`) | ✅ | `BecomeSellerEnvelope extends CoreEntity` (`:132-135`) |
| Objeto interno con las 24 claves reales, nombres exactos | ✅ | `BecomeSellerOptions` (`:102-127`), orden idéntico al JSON |
| `banner` clase propia de 9 claves, NO `Attachment` | ✅ | `BecomeSellerBanner` (`:18-28`) |
| `CommissionItem.max_balance: string` | ✅ | `:94` |
| `guidelineItems[].link` admite `null` | ✅ | `:61` (`string \| null`) |
| `userStories[].thumbnail` objeto | ✅ | `:73` (`BecomeSellerImage`) |
| DTO `{ language?, page_options, commissions }` sin `id` | ✅ | `create-become-seller.dto.ts:11-15` |
| Ningún `missions` sobrevive bajo el módulo | ✅ | ver greps abajo |

Greps (los tres corridos aquí):

```
$ grep -rnw missions apps/api/rest/src/become-seller/
(vacío — exit 1)

$ grep -rnP '(?<!com)missions' apps/api/rest/src/become-seller/
(vacío — exit 1)

$ grep -rn missions apps/api/rest/src/become-seller/ | wc -l
24     <- las 24 coincidencias son la palabra `commissions`
```

**Confirmado el hallazgo del ejecutor**: el grep LITERAL que pide el
escenario del spec y el DoD (`grep -rn missions`) no puede dar vacío
mientras el código use correctamente `commissions`, porque `missions` es
subcadena de `com`+`missions`. La intención del criterio (que no
sobreviva ningún campo llamado `missions`) SÍ se cumple, verificada por
dos vías independientes (`-w` y un look-behind negativo de PCRE). Es un
defecto de redacción del comando, no del cambio.

Detalles adicionales verificados y correctos, que ninguna CA exigía
explícitamente: `CommissionItem.id: number` (el dato es `79`, no string),
`CommissionItem` NO extiende `CoreEntity` con un comentario que explica
por qué (`:81-87`), `icon: { value: string }` inline, y las 6 imágenes del
payload comparten la forma local `BecomeSellerImage`.

### R2 — El documento OpenAPI publica el contrato verdadero (CA-2) → **MET**

Salida completa, resuelta SIEMPRE por `$ref` desde `paths`, nunca por
nombre fijo de schema:

```
verbos declarados: [ 'post', 'get' ]
POST requestBody $ref: #/components/schemas/CreateBecomeSellerDto
POST body props: ["language","page_options","commissions"]
POST body required: ["page_options","commissions"]
POST 201 $ref: #/components/schemas/BecomeSeller | GET 200 $ref: #/components/schemas/BecomeSeller
201 top props: ["page_options","commissions"]
200 top props: ["page_options","commissions"]
envelope $ref: #/components/schemas/BecomeSellerEnvelope props: ["page_options","language","id","created_at","updated_at"]
inner $ref (resp): #/components/schemas/BecomeSellerOptions | (body): #/components/schemas/BecomeSellerOptions
inner props count: 24
inner props === Object.keys del JSON real: OK
banner $ref: #/components/schemas/BecomeSellerBanner
banner props (9): ["newsTickerTitle","newsTickerURL","title","description","button1Name","button1Link","button2Name","button2Link","image"]
commissions schema: {"type":"array","items":{"$ref":"#/components/schemas/CommissionItem"}}
CommissionItem props: ["id","level","sub_level","description","min_balance","max_balance","commission","image","language","created_at","updated_at"]
max_balance: {"type":"string"}
guidelineItem.link: {"type":"string","nullable":true}
--- D-9 colateral ---
global Banner props (4): ["id","title","description","image"]
Type.banners: {"type":"array","items":{"$ref":"#/components/schemas/Banner"}}
total schemas: 193
```

Punto por punto: `required` sin `id` **ni** `language` ✅; top-level de
`get.200` y `post.201` exactamente `page_options`/`commissions` ✅;
envoltorio en las 5 claves ✅ (el conjunto coincide; el ORDEN pone las
heredadas de `CoreEntity` al final — el spec pide el conjunto, y el orden
del cuerpo HTTP se fija en el servicio, no en el documento); objeto
interno en 24 props idénticas a `Object.keys` del JSON ✅; `banner` en 9
props y sin `$ref` a `Attachment` ✅; `max_balance` en `type:"string"` sin
`oneOf` ✅ (posible porque `CommissionItem` pasó a `class`, D-2);
`link` nullable ✅ (el `@ApiProperty` funcionó; la contingencia del D-7 no
hizo falta).

**Colateral D-9 en verde**: el `Banner` global preexistente conserva sus 4
propiedades y `Type.banners` sigue apuntando a él — `/api/types` no se
corrompió. El documento pasó de 185 a 193 schemas (+8, ninguno colisiona).

**Comparación con el "antes"** (artefacto del ejecutor `docs-antes.json`,
inspeccionado aquí y corroborado contra `git show HEAD:`):

```
POST body props: ["id","page_options","language","missions"] required: ["id","page_options","language","missions"]
GET 200 top props: ["page_options","language","missions","id","created_at","updated_at"]
BecomeSellerOptions props (12): ["banner","sellingStepsTitle",...,"faqItems"]
banner: {"$ref":"#/components/schemas/Attachment"}
BecomeSeller.missions: {"type":"array","items":{"type":"object"}}
total schemas: 185
```

#### 2.1 Frescura del documento — cómo se estableció (no se dio por buena)

El módulo cambió dos veces, así que el riesgo de estar leyendo un proceso
viejo era real. Se estableció por **tres** vías independientes, todas
derivadas aquí:

1. **El proceso que escucha en :9001 sirve `dist/`, y ese `dist/` es el
   corregido.** El proceso (PID 53332) tiene `CommandLine`
   `node ... C:\...\apps\api\rest\dist\main` y `CreationDate`
   `9/18/2026 12:55:38 PM`, posterior a la última modificación de las
   fuentes del módulo (servicio 12:49:50, spec 12:53:01) y al `dist`
   compilado a las 12:53:51. Y `dist/become-seller/become-seller.service.js`
   contiene las guardas **simétricas** corregidas
   (`_isBecomeSellerOptions`/`_isCommissionList`), sin rastro de
   `_isJsonPayload`: el binario en ejecución es el del lote correctivo, no
   el del primero.
2. **`just build-api` corrido en esta fase reproduce el mismo documento.**
   Tras el build (que borra y recompila `dist/`), `/docs-json` volvió a
   capturarse y es **byte a byte idéntico** al capturado antes del build
   (`cmp` sin diferencias). El documento en memoria es, por tanto,
   reproducible desde la fuente actual.
3. **La metadata emitida por el plugin coincide con el documento.** El
   `dist/become-seller/entities/become-seller.entity.js` recién compilado
   emite `_OPENAPI_METADATA_FACTORY` con las 24 claves de
   `BecomeSellerOptions`, `banner → BecomeSellerBanner`,
   `max_balance: () => String`, `link: {type: () => String, nullable: true}`,
   y el DTO emite `language: {required: false}` + `page_options` +
   `commissions`, sin `id`. El controller lleva los
   `openapi.ApiResponse({status: 201|200, type: BecomeSeller})` inyectados
   por el plugin.

### R3 — El servicio no reinterpreta su DTO con escapes de tipos (CA-3) → **MET en la letra; PARCIAL en la sustancia**

La letra del requirement se cumple entera, y se verificó sobre el MÓDULO
COMPLETO (más estricto que el grep del spec, que solo pide el servicio):

```
$ grep -rn "as unknown as\|as any\|ts-ignore\|ts-expect-error\|: any" apps/api/rest/src/become-seller/
(vacío — exit 1)
```

- `BecomeSellerWriteBody` desapareció (no existe en el archivo).
- `create()` (`:71-79`) desestructura `dto.page_options`/`dto.commissions`/
  `dto.language` directo del DTO tipado.
- `_toEnvelope()` (`:112-121`) devuelve su literal **sin ningún `as`**, y
  compila: lo prueban `just build-api` en verde y `npx jest` en verde
  (ts-jest sin `isolatedModules` hace type-check completo).

**La sustancia, dicha sin adornos**: los dos predicados **afirman más de
lo que comprueban**. `_isBecomeSellerOptions` solo comprueba
"objeto no-nulo y no-array" pero declara `value is BecomeSellerOptions &
Prisma.InputJsonObject` (24 claves obligatorias); `_isCommissionList` solo
comprueba `Array.isArray` pero declara `value is CommissionItem[] &
Prisma.InputJsonArray`. Comportamiento real de las guardas compiladas,
ejercitado aquí con su código exacto:

```
falla la guarda -> se OMITE   | page_options: null
falla la guarda -> se OMITE   | page_options: "texto"
falla la guarda -> se OMITE   | page_options: [1,2,3]
PASA la guarda -> se PERSISTE | page_options: {}
PASA la guarda -> se PERSISTE | page_options: {foo:"bar"}
falla la guarda -> se OMITE   | commissions: {a:1}
falla la guarda -> se OMITE   | commissions: null
PASA la guarda -> se PERSISTE | commissions: []
PASA la guarda -> se PERSISTE | commissions: [1,2,3]
```

Es decir: en términos de **solidez de tipos**, un predicado que estrecha a
una forma que no verifica es equivalente a un cast — solo que localizado
en una función, revisable, y respaldado por una comprobación de runtime
que antes no existía en absoluto.

Veredicto matizado, sin taparlo:

- **En la letra: CUMPLIDO.** Los MUST del requirement son literales
  (sin `as unknown as`/`as any`/`ts-ignore`/`ts-expect-error`/`: any`, sin
  `BecomeSellerWriteBody`, `_toEnvelope()` sin cast) y los tres se
  verifican.
- **En la sustancia: MEJORA REAL, NO SOLIDEZ.** Respecto de `main` es una
  mejora clara (antes no había ninguna comprobación; ahora hay una, y es la
  MISMA en escritura y lectura, que es lo que cierra el defecto del primer
  lote). Pero no es tipado sólido: `{}` y `[1,2,3]` siguen pasando.
  Alcanzar solidez exigiría validar las 24 claves en runtime —
  efectivamente, un validador— y eso está en el "NO incluye" vinculante de
  la US (`class-validator`, superficie de error del `POST`). Así que el
  hueco es **consecuencia del scope, no un incumplimiento**; queda
  registrado como deuda explícita para una US hermana.

### R4 — Una red de tipos detecta drift del contrato interno (CA-3 / D-4) → **MET**

Re-derivado en esta fase, NO llevado del apply. Se montó una copia de la
entidad, el DTO, `core.entity.ts`, el JSON real y una copia literal de la
red D-10 (`become-seller.service.spec.ts:79-96`) en el scratchpad, con un
`tsconfig` calcado del real, y se compiló con el `tsc` del propio repo
(`apps/api/rest/node_modules/.bin/tsc`, v4.9.5). **No se tocó ningún
archivo del repo.**

```
===== base, sin sabotaje =====
EXIT=0

===== (a) DTO: commissions -> missions =====
net.ts(20,7): error TS2322: Type 'true' is not assignable to type
  'KeyDrift<CreateBecomeSellerDto, "page_options" | "commissions" | "language">'.
EXIT=2

===== (b) entidad: se elimina la clave contact (24 -> 23) =====
net.ts(16,7): error TS2322: Type 'true' is not assignable to type '"contact"'.
EXIT=2

===== (c) entidad: contact -> contacto (typo, deriva en AMBAS direcciones) =====
net.ts(16,7): error TS2322: Type 'true' is not assignable to type
  'KeyDrift<BecomeSellerOptions, "defaultCommissionRate" | ... 17 more ... | "userStories">'.
EXIT=2

===== (d) entidad: clave de mas (25 claves) =====
net.ts(16,7): error TS2322: Type 'true' is not assignable to type '"claveInventada"'.
EXIT=2

===== (e) restaurado -> VERDE =====
EXIT=0
```

Los dos escenarios del spec se cumplen literalmente: renombrar
`commissions` rompe (a), y eliminar una de las 24 claves rompe (b) y
vuelve a verde al restaurar (e). Además la red funciona en la dirección
inversa (d, clave de más) y nombra la clave a la deriva en (b) y (d),
como prometía D-10. La red usa `keyof`/`Exclude`, sin `satisfies`.

Complemento de deriva de TIPO (la fixture `realCreateDto()`, copiada
literal):

```
(g) entidad: max_balance string -> number
    error TS2322: ... Types of property 'max_balance' are incompatible.
      Type 'string' is not assignable to type 'number'.     EXIT=2

(i) entidad: userStories[].thumbnail objeto -> string
    error TS2322: ... Types of property 'thumbnail' are incompatible.  EXIT=2

(h) entidad: link: string | null  ->  link: string          EXIT=0  (NO detectado)
```

**Precisión que conviene registrar** (no es incumplimiento: ninguna
cláusula de R4 lo pide): la nulabilidad de `guidelineItems[].link` NO está
protegida por la red, porque el `tsconfig.json` de la API no activa
`strictNullChecks` y `null` es asignable a `string`. Lo único que sostiene
ese matiz es el `@ApiProperty({type: String, nullable: true})`, verificado
en vivo en R2. Si alguien "simplifica" el tipo a `string`, no se entera
nadie salvo por el documento OpenAPI.

Segunda precisión: el `it()` de runtime fija el orden de las 24 claves del
**JSON del mock**, no el del cuerpo HTTP. El cuerpo en vivo llega con otro
orden (jsonb de Postgres reordena por longitud/bytes) — ver R5.

### R5 — Sin regresión de contrato HTTP ni de gates (CA-4) → **MET**

**`GET /api/became-seller`** (corrido aquí, contra la API en vivo):

```
$ curl -s -o /dev/null -w "HTTP=%{http_code} size_download=%{size_download}\n" http://localhost:9001/api/became-seller
HTTP=200 size_download=11452

bytes antes: 11452 | bytes ahora: 11452
deepStrictEqual OK (excluyendo created_at/updated_at del envoltorio)
antes ts: 2026-09-15T17:41:00.858Z 2026-09-15T17:41:00.858Z
ahora ts: 2026-09-15T17:41:00.858Z 2026-09-15T17:41:00.858Z
deepStrictEqual COMPLETO (incl. timestamps): OK
top keys: [ 'page_options', 'commissions' ] | envelope keys: [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ]
inner keys count: 24 | commissions len: 2 | max_balance: [ [ 'string', '3000' ], [ 'string', '1000' ] ]
```

El `deepStrictEqual` **completo** (timestamps incluidos) es además la
prueba de que la fila quedó correctamente restaurada tras los `POST` del
apply y del lote correctivo.

Para no depender de confiar en `antes.json` (artefacto del ejecutor), se
comparó también contra el mock versionado en git, que es fuente de verdad
independiente:

```
El GET en vivo deepStrictEqual al MOCK original (excl. timestamps del envoltorio): OK
```

Nota de precisión, **preexistente a esta US** (no regresión): el ORDEN de
las claves del objeto interno en el cuerpo en vivo no es el del mock —
Postgres reordena las claves del `jsonb`. `antes.json` trae exactamente el
mismo orden que el `GET` de hoy, así que el cambio no lo tocó. El tamaño
coincide (11 452 B) porque reordenar no altera el total de caracteres.

**Gates** (los cuatro corridos aquí):

```
$ cd apps/api/rest && npx jest
Test Suites: 10 passed, 10 total
Tests:       294 passed, 294 total
Time:        175.999 s
[exited with code 0]
```
294 ≥ 291 exigidos, 10 = 10 suites. (Coincide con el recuento del lote
correctivo; el orquestador lo había medido igual de forma independiente.)

```
$ just build-api
$ rimraf dist
$ nest build
Done in 118.17s.
[exited with code 0]
```
Único punto donde corre el plugin CLI de `@nestjs/swagger`.

```
$ just db-check
 Test Files  12 passed (12)
      Tests  228 passed (228)
```
Idéntico a la base (12/228): `packages/db` no se tocó — `git status` lo
confirma.

```
$ just verify
OK   API    :9001/api/settings  200  5503B  1360ms
OK   Shop   :3003/en  200  190788B  2276ms  cards:30
OK   Admin  :3002/en/login  200  72821B  196ms  cards:1
```
`/api/settings` en 5503 B. Comprobado además que la página del shop que
hace SSR del endpoint renderiza:
`GET :3003/en/become-seller → HTTP 200, 108 445 B`.

**`git diff --stat`**:

```
 .../become-seller/become-seller.service.spec.ts    | 193 ++++++++++++++++-----
 .../src/become-seller/become-seller.service.ts     |  67 ++++---
 .../become-seller/dto/create-become-seller.dto.ts  |  20 ++-
 .../become-seller/entities/become-seller.entity.ts | 143 +++++++++++----
 4 files changed, 322 insertions(+), 101 deletions(-)
```

423 líneas de código, acotadas a `apps/api/rest/src/become-seller/`.
`git status --short` muestra, además del módulo, solo
`docs/product/45-entidad-become-seller-desalineada.md` (+20/−10, exigido
por el propio DoD) y el directorio sin trackear
`openspec/changes/become-seller-contrato-tipos/`. Ningún archivo bajo
`packages/`, `db/`, `apps/shop`, `apps/admin`, `common/`, `main.ts`,
`nest-cli.json` ni la config de jest. `update-become-seller.dto.ts`
confirmado sin diff (D-12).

---

## 3. Matriz de cumplimiento de escenarios

| Req | Escenario | Evidencia | Resultado |
|---|---|---|---|
| R1 | El envoltorio y el objeto interno coinciden con el payload real | `npx jest` (pin de 24 claves + `AssertSameKeys`) + lectura de la entidad contra `Object.keys` del JSON | ✅ COMPLIANT |
| R1 | El DTO del POST no exige campos de más y `missions` desaparece | `_dtoKeys` (compilación) + `grep -rnw` / `grep -rnP` vacíos | ✅ COMPLIANT (con el matiz del grep literal) |
| R2 | El body del POST y las respuestas resueltos por `$ref` | `/docs-json` en vivo tras `just build-api`, con prueba de frescura triple (§2.1) | ✅ COMPLIANT |
| R2 | `max_balance` observable como string porque `CommissionItem` es clase | `/docs-json`: `{"type":"string"}`, sin `oneOf`; metadata compilada `max_balance: () => String` | ✅ COMPLIANT |
| R3 | Cero escapes de tipos, incluidos comentarios | `grep` del módulo completo, vacío | ✅ COMPLIANT |
| R3 | `_toEnvelope()` compila sin cast | Lectura del literal (`:112-121`) + `just build-api` + `npx jest` en verde | ✅ COMPLIANT |
| R4 | Renombrar `commissions` rompe la compilación | Sabotaje (a) sobre copias: `TS2322` real; restaurado en verde | ✅ COMPLIANT |
| R4 | Eliminar una de las 24 claves rompe la compilación | Sabotajes (b), (c), (d): `TS2322` nombrando la clave; (e) verde | ✅ COMPLIANT |
| R5 | El contrato HTTP se re-verifica sin cambiar | `curl` 11 452 B + `deepStrictEqual` vs `antes.json` y vs el mock | ✅ COMPLIANT |
| R5 | Los gates cierran en verde y el diff queda acotado | `npx jest` 10/294, `just build-api`, `just db-check` 12/228, `just verify` 5503 B, `git diff --stat` | ✅ COMPLIANT |

**Resumen: 10/10 escenarios compliant.**

Nota metodológica: los escenarios de R2 no tienen suite automatizada que
los cubra, y no puede haberla — el plugin CLI de `@nestjs/swagger` solo
corre en `nest build`/`nest start`, nunca en `ts-jest` (así lo dice la
propia US). Su evidencia de runtime es la captura del documento en vivo
tras el build, que es exactamente la forma de evidencia que
`openspec/config.yaml` (`rules.verify.require_evidence: true`) define para
este repo. Se marcan COMPLIANT por evidencia de ejecución real, no por
suite.

---

## 4. Los tres puntos abiertos, juzgados

### 4.1 La solidez residual de los predicados

Ya desarrollado en R3. Resumen del juicio: **R3 se cumple en la letra y es
una mejora real en la sustancia, pero no es solidez de tipos.** Los
predicados declaran un estrechamiento (24 claves / `CommissionItem[]`) que
su cuerpo no verifica (`{}` y `[1,2,3]` pasan). La diferencia importante
frente al estado anterior no es la solidez, sino la **simetría**: la misma
condición gobierna escritura y lectura, así que la clase de fallo que
encontró el revisor (escribir algo que la lectura rechaza para siempre) ya
no es representable. Cerrar el hueco restante exige validación de 24
claves en runtime, expresamente fuera del scope de la US.

### 4.2 El disclosure del delta de runtime — ¿coincide ahora con el código?

Se leyó el CÓDIGO (no el disclosure) y se comparó en las dos direcciones.

**Camino de escritura — correcto en sus dos casos:**

- `page_options: null` / `commissions: null` → la guarda falla, la clave se
  omite, el `POST` responde 201. Antes llegaba a Prisma; el repositorio
  (`packages/db/src/repositories/become-seller.repository.ts:36-45`) hace
  `...(input.pageOptions !== undefined && { pageOptions: input.pageOptions })`,
  así que un `null` explícito sí se reenviaba a `prisma.becomeSeller.update`
  y el cliente lo rechaza para una columna `Json` (exige el centinela
  `Prisma.JsonNull`) → 500. ✅ La descripción es correcta.
- `page_options: "texto"` → escalar legal para `Prisma.InputJsonValue`:
  antes 201 con fila corrupta en silencio, no 500. ✅ La corrección del
  Defecto 2 es exacta; la redacción del primer lote sí era falsa aquí.

**Camino de lectura — correcto y en la dirección opuesta:** una fila que ya
tuviera `commissions` no-array o `page_options` no-objeto ahora produce
`InternalServerErrorException` (500) en cada `GET`, donde antes se servía
200 con basura. ✅ Descrito, y descrito como delta permanente hasta
arreglar la fila a mano.

**Una frase SÍ sigue siendo sobre-amplia** (WARNING-1, ver §5): el
disclosure dice que las guardas *"require the exact runtime shape"* y
concluye *"a malformed value can no longer silently corrupt the row on
write, for either field"*. La tabla de §R3 lo desmiente: `page_options:
{}`, `page_options: {"foo":"bar"}`, `commissions: []` y
`commissions: [1,2,3]` **pasan** la guarda, se persisten, y la lectura
posterior los acepta (200 con basura). Lo que se impide es la corrupción
por **forma gruesa** (objeto vs array vs escalar vs null), no toda
corrupción. Es la misma limitación de §4.1 asomando en la prosa: el
disclosure describe correctamente los tres casos concretos que enumera y
se pasa de frenada al generalizarlos. Dado que el owner ratificó el
disclosure *a condición de que fuera exacto*, esta frase debería
acotarse.

### 4.3 El diff de 423 líneas contra el presupuesto de 400

Reportado, no tratado como fallo. `size:exception` concedida por el owner
y vigente; `delivery_strategy: single-pr`. 423 = 322 inserciones + 101
borrados, 23 por encima del presupuesto. El incremento sobre las 367 del
primer lote (+56) es atribuible a los 2 tests de regresión del Defecto 1 y
al comentario ampliado que explica la asimetría corregida — es decir,
íntegramente a la corrección y su evidencia. No se comprimió ni se
partió, que era la instrucción. Se confirma además que **no** se usó la
palanca prohibida (quitar el prefijo `BecomeSeller` de las clases nuevas):
las 8 clases nuevas lo conservan y el `Banner` global sigue intacto (D-9).

---

## 5. Issues

**CRITICAL**: ninguno.

**WARNING**

1. **Frase sobre-amplia en el disclosure de runtime** (`apply-progress.md`,
   sección "Runtime Delta", punto 1): *"both write guards require the exact
   runtime shape"* / *"a malformed value can no longer silently corrupt the
   row on write, for either field"*. Falso para `{}`, `{"foo":"bar"}`, `[]`
   y `[1,2,3]`, que pasan la guarda y se persisten. Debería decir "forma
   gruesa (objeto-no-array / array)". Es documental, no de código; el
   owner ratificó el disclosure condicionado a su exactitud. **No se
   corrigió aquí**: esta fase no edita `apply-progress.md`.
2. **Solidez residual de los predicados de tipo** (§4.1). No incumple R3,
   pero deja abierto que `_isBecomeSellerOptions({})` afirme 24 claves. Es
   consecuencia del "NO incluye" de la US (sin `class-validator`).
   Candidata a US hermana junto con `settings.service.ts:39`.
3. **La nulabilidad de `guidelineItems[].link` no está protegida por la red
   de tipos** (§R4, sabotaje (h) en verde), solo por el `@ApiProperty` y el
   documento OpenAPI. Sin `strictNullChecks` no hay forma barata de
   protegerla; conviene que quede escrito.
4. **Edición de prosa del DoD en el documento de la US — decisión del
   owner.** El ejecutor no solo marcó checkboxes y el `Status`: añadió al
   bullet del `grep` el matiz de que `missions` es subcadena de
   `commissions`. **El matiz es factualmente CORRECTO** — verificado aquí
   por dos vías independientes (`grep -rnw` y `grep -rnP '(?<!com)missions'`,
   ambos vacíos, frente a 24 coincidencias del grep sin límite de palabra,
   todas de `commissions`). Aun siendo correcto, es una edición a un
   criterio de aceptación en un documento que pertenece al owner: **el
   owner decide si lo acepta o lo revierte.** Se deja tal cual, señalado,
   no accionado (igual que hizo el lote correctivo).
5. **El `git diff` incluye un archivo fuera de `apps/api/rest/src/become-seller/`**:
   `docs/product/45-entidad-become-seller-desalineada.md` (+20/−10). La
   letra de R5 dice que el diff "MUST limitarse a
   `apps/api/rest/src/become-seller/`", pero el propio DoD de la US exige
   actualizar ese documento, así que es una contradicción de redacción
   entre spec y US, no una violación de scope. Ningún archivo bajo
   `packages/`, `db/`, `apps/shop`, `apps/admin` ni `openspec/specs/` fue
   tocado.
6. **423 líneas > presupuesto de 400** (§4.3). Cubierto por la
   `size:exception` del owner; se registra, no bloquea.

**SUGGESTION**

- `npx jest` emite *"A worker process has failed to exit gracefully"* al
  final. La corrida cierra con `exit 0` y 294/294 en verde; parece fuga de
  handles del arnés (pool de `pg` vía `@safari/db`), no de esta US. Vale la
  pena mirarlo cuando se construya el `just check` agregador (US-10).
- Deuda adyacente ya mencionada y NO accionada, correctamente listada por
  el apply: `settings.service.ts:39` (mismo patrón de cast),
  `common/entities/attachment.entity.ts` sin `file_name` (y
  `BecomeSellerImage` duplicando el concepto, coste declarado en D-6),
  `apps/shop/src/types/index.ts:1232-1237` (`commission` singular),
  `apps/admin/rest/src/types/index.ts:2123,2196` (`max_balance: number`,
  `thumbnail: string`). Ninguna se tocó: correcto.
- Sobre validadores en el DTO: la US preguntaba explícitamente si el agente
  cree que hacen falta. Esta verificación coincide con que **sí harían
  falta** para cerrar de verdad §4.1 — la ruta es `@Public()`, sin guard,
  con `ValidationPipe` sin opciones — pero también en que introducirlos
  cambia la superficie de error del `POST` y merece su propia US con su
  propio test de que el body real del admin sigue pasando.

---

## 6. Coherencia con el diseño

| Decisión | ¿Respetada? | Nota |
|---|---|---|
| D-1 Opción A (clases compartidas en la entidad, importadas por el DTO) | ✅ | `create-become-seller.dto.ts:1` importa de la entidad; cero archivos nuevos |
| D-2 `CommissionItem` pasa a `class` | ✅ | Habilita `max_balance: {"type":"string"}` en `/docs-json` |
| D-3 `max_balance: string` a secas | ✅ | Sin `oneOf` en el documento |
| D-4 / D-10 Red `keyof`/`Exclude`, sin `satisfies` | ✅ | Re-demostrada en R4 |
| D-5 El comentario reescrito no repite la frase prohibida | ✅ | Grep del módulo vacío |
| D-6 `BecomeSellerImage` local, `Attachment` sin tocar | ✅ | `attachment.entity.ts` sin diff |
| D-7 `@ApiProperty({nullable:true})` | ✅ | `link: {"type":"string","nullable":true}` en vivo; contingencia no ejercida |
| D-8 Guardas con parámetro `unknown`, sin escapes | ✅ (con el matiz de §4.1) | Ensanchadas a la intersección `<Clase> & Prisma.InputJson{Object,Array}` en el lote correctivo |
| D-9 Prefijo `BecomeSeller` en clases nuevas | ✅ | `Banner` global con sus 4 props; `Type.banners` con su `$ref` |
| D-11 Fixtures desde el JSON real, sin cast | ✅ | `realCreateDto()`; `malformedDto()` usa `JSON.parse(JSON.stringify(...))` |
| D-12 `update-become-seller.dto.ts` con cero diff | ✅ | Sin cambios en `git status` |
| Desviación: 3 guardas en vez de 4 → **2** tras la corrección | ⚠️ documentada | `_isJsonPayload` eliminada; la desviación está registrada en `tasks.md` 7.1 y `apply-progress.md` |

---

## 7. Veredicto

**PASS WITH WARNINGS.**

Los 5 requirements y los 4 criterios de aceptación se cumplen, con
evidencia de ejecución real re-derivada en esta fase (no heredada):
`/docs-json` en vivo con prueba de frescura propia, rojo/verde de la red de
tipos reproducido sobre copias con el `tsc` del repo, `GET` en 11 452 B con
`deepStrictEqual` contra dos referencias independientes, y los cuatro gates
(`npx jest` 10/294, `just build-api`, `just db-check` 12/228, `just verify`
con `/api/settings` en 5503 B) en verde. El defecto que encontró la
revisión independiente está realmente cerrado: las guardas de escritura y
lectura son la MISMA condición por campo, comprobado sobre el `dist` que
el proceso en ejecución está sirviendo.

Las advertencias no bloquean el archivado: una es una frase sobre-amplia en
un documento del change, dos son límites conocidos y derivados del scope
vinculante de la US, y tres son decisiones que pertenecen al owner (la
edición de la prosa del DoD, la `size:exception` de 423 líneas y el archivo
`docs/product/` en el diff).

**Listo para `sdd-archive`**, con dos salvedades que el owner debe resolver
antes o durante el archivado:

1. Decidir sobre la edición de prosa del DoD en
   `docs/product/45-entidad-become-seller-desalineada.md` (§5 WARNING-4).
   El contenido es correcto; lo que está en cuestión es la autoría.
2. Decidir si quiere que se acote la frase sobre-amplia del disclosure
   (§4.2 / §5 WARNING-1) antes de que `apply-progress.md` pase al archivo,
   que es un rastro de auditoría inmutable.

Esta fase NO corrigió código ni documentos: solo escribió
`verify-report.md` y el bloque `verify` de `state.yaml`.
