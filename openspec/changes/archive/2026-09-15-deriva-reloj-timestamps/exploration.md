# Exploration: US-32 — Deriva de reloj entre `created_at` y `updated_at`

## Current State

### 1. El lado del trigger (`db/schema.sql`)

Líneas reales verificadas (el archivo tiene 504 líneas):

- `tocar_updated_at()`: **`db/schema.sql:480-486`** (7 líneas: `CREATE OR REPLACE
  FUNCTION` en 480, `RETURN NEW;`/`END;`/`$$;` cierran en 486). El cuerpo hace
  `NEW.updated_at = now();` (línea 483) **sin condición** (ningún `IF`/`WHEN`).
- Bloque de `CREATE TRIGGER`: **`db/schema.sql:488-500`** (los 5
  `CREATE OR REPLACE TRIGGER ... BEFORE UPDATE ... FOR EACH ROW EXECUTE
  FUNCTION tocar_updated_at();`, con dos líneas de comentario intercaladas en
  494-496). Las 5 tablas son, en orden: `products` (488-489), `categories`
  (490-491), `shops` (492-493), `users` (497-498), `profiles` (499-500).
  Confirmado `BEFORE UPDATE` en las 5, todos incondicionales.

**Discrepancia de línea, código gana:** el propio texto de US-32 se cita a sí
mismo dos veces con números distintos — `:479-486` / `:488-499` en su
"Contexto" (línea 39, 42 del documento). Ninguno de los dos es exacto: `479`
es una línea de comentario (`-- ---...`), no parte de la función (la función
empieza en `480`); y `499` corta el bloque de triggers un línea antes de
tiempo (falta el trigger de `profiles`, que termina en `500`). El propio
código de `packages/db` (comentarios en `tags.repository.ts:169` y
`manufacturers.repository.ts:196`) cita **`db/schema.sql:480-500`** como rango
único (función + triggers) — es la cita correcta y la que este documento usa
en adelante.

### 2. El lado de Prisma (`packages/db/prisma/schema.prisma`)

Verificado línea por línea (320 líneas totales): **no hay ninguna diferencia
declarativa** entre las 5 tablas con trigger y las 3 sin trigger. Los 8
modelos usan la misma forma exacta:

| Modelo | `createdAt` | `updatedAt` |
|---|---|---|
| `Product` (trigger) | `:183` `@default(now()) @map("created_at") @db.Timestamptz(6)` | `:184` idéntico patrón |
| `Category` (trigger) | `:100` | `:101` |
| `Shop` (trigger) | `:81` | `:82` |
| `User` (trigger) | `:240` | `:241` |
| `Profile` (trigger) | `:258` | `:259` |
| `Type` (sin trigger) | `:59` | `:60` |
| `Tag` (sin trigger) | `:140` | `:141` |
| `Manufacturer` (sin trigger) | `:122` | `:123` |

Ningún modelo usa `@updatedAt` (grep sobre todo el archivo: 0 resultados). Es
decir: **Prisma no puede modelar el trigger** (documentado en su propia
cabecera, `:10-16`, que lista las CHECK y los índices que se le escapan, pero
no menciona triggers), así que la divergencia de comportamiento vive
enteramente en `db/schema.sql` + el código de los repositorios, nunca en
`schema.prisma`. Confirma el punto 2 de la investigación: el contraste no es
"heredado de la prosa de la US", es un hecho verificable — y a la vez aclara
que **no hay nada que re-alinear en `schema.prisma` con un simple cambio de
atributo** (ver Opción A abajo, tiene un costo real de mantenimiento).

### 3. El lado del reloj de aplicación (`packages/db/src/clock.ts` + repositorios)

`clock.ts` (20 líneas) es mínimo: un `_nowProvider` mutable, `_setNowProvider`
(solo tests) y `now()`. Cero documentación de alcance hoy —
`packages/db/README.md:37` solo dice "`clock.ts` — `now()` inyectable para
tests", sin decir sobre qué columnas. Confirma que **CA-3 (documentar el
alcance) está genuinamente sin cumplir hoy**.

Call sites reales que escriben `createdAt`/`updatedAt` con `now()` de
`clock.ts` (verificados, no asumidos de la prosa de la US):

- `types.repository.ts:136` — `updatedAt: now()` en `updateType`. Coincide
  con la cita de la US.
- `tags.repository.ts:190` — `updatedAt: now()` en `updateTag`. La US cita
  `:178`; la línea real hoy es **190** (el archivo se movió desde que se
  escribió la US; `:178` hoy es `_assertValidTypeId(input.typeId);`).
- `manufacturers.repository.ts:217` — `updatedAt: now()` en
  `updateManufacturer`. La US cita `:205`; la línea real es **217** (`:205`
  hoy es la misma llamada a `_assertValidTypeId`).
- **Una que la US no menciona:** `auth-tokens.repository.ts:171,207` —
  `consumedAt: now()` en `password_reset_tokens`/`otp_codes` (tablas sin
  trigger, fuera de las 5, pero también gobernadas por `clock.ts`). No cambia
  el análisis de las 5 tablas con trigger, pero es un consumidor adicional de
  `_setNowProvider` que CA-3 debe nombrar si documenta "qué tablas sí".

**Ninguno de los repositorios de las 5 tablas con trigger** (`products.
repository.ts`, `categories.repository.ts`, `shops.repository.ts`,
`users.repository.ts`; `profiles` se crea anidado dentro de
`users.repository.ts:293-294`, sin repositorio propio) **escribe
`updatedAt` explícitamente en ningún `update`** — grep confirmado, cero
matches. Confirma que el trigger gobierna `updated_at` sin competencia en
esas 5.

**Matiz que la US no dice pero el código sí:** `createdAt` en `create()` NO
se escribe explícitamente en NINGÚN repositorio — ni en los 5 con trigger ni
en los 3 "sanos" (`types.repository.ts:91`, `tags.repository.ts:143`,
`manufacturers.repository.ts:169`: ningún `create()` fija `createdAt`). Es
decir, `_setNowProvider` **hoy no tiene efecto sobre `createdAt` en ninguna
tabla del repo**, ni siquiera en las 3 que la US declara "no afectadas" —
esas tres son coherentes porque `createdAt` (Prisma/Node en el INSERT) y
`updatedAt` (repositorio/Node en el UPDATE) comparten reloj de Node, no
porque ambas pasen por `clock.ts`. Esto es relevante para CA-3: la
documentación que pide debe decir "afecta `updated_at` de `types`/`tags`/
`manufacturers`/`consumedAt` de `password_reset_tokens`/`otp_codes`; no afecta
`created_at` de ninguna tabla, ni `updated_at` de las 5 con trigger" — más
preciso que "esas tres no están afectadas".

### 4. Auditoría de dependientes — hallazgo de mayor valor

**`packages/db`, tests de integración** — tres suites documentan y **ya
diseñan sus asserts alrededor de la deriva**, con comentarios extensos que
explican por qué:

- `categories.integration.test.ts:277-319` (`describe` en 277): compara
  **solo** `updateCategory` → `updateCategory` (nunca `create` → `update`),
  con `toBeGreaterThan` estricto (no `>=`) porque "con `>=`... el trigger sin
  disparar... produce una IGUALDAD exacta y el test PASA igual" (comentario
  :306-313). El propio comentario (:279-289) explica que comparar
  `created.updatedAt` (Node) contra `updated.updatedAt` (Postgres) "mezcla
  dos relojes distintos" y puede divergir "varios cientos de ms".
- `products.integration.test.ts:517-568`: mismo patrón, con más detalle
  cuantitativo (:517-539): confirma con `log:['query']` y un script ad hoc
  que el INSERT liga `created_at`/`updated_at` como parámetros (reloj de
  Node) sin `@updatedAt`, mide con un probe `clock_timestamp()`/`Date.now()`
  una divergencia de **~150-450ms**, "deriva en vivo (no es un offset fijo)",
  "no hay garantía de signo".
- `shops.integration.test.ts:373-411`: mismo patrón (`describe` en 373),
  mismo razonamiento (:375-380).

**Ninguna de las tres compara `createdAt` contra `updatedAt` directamente**
(el invariante que CA-2 de US-32 pide todavía no existe como test). Por eso
**ningún assert existente se rompe** al cambiar la fuente de `created_at`: el
"costo real" que la US pide comprobar (nota final, líneas 134-136) es que
estos tres comentarios quedarían **obsoletos/inexactos** tras CA-1 (ya no
haría falta evitar create-vs-update), no que algo falle. Es limpieza
adyacente — mencionar, no accionar (US-32 no la pide).

`_setNowProvider` solo se usa en 4 archivos de test: `auth-tokens.
integration.test.ts`, `manufacturers.integration.test.ts`,
`tags.integration.test.ts`, `types.integration.test.ts` — ninguno de los 5
agregados con trigger. Confirma que la opción elegida en CA-1 **no puede
romper la semántica de `_setNowProvider` para el resto de la suite** (ya no
la toca hoy), satisfaciendo el "NO incluye" de la US sin esfuerzo adicional.

**`apps/api/rest/src/`** — `categories.service.ts` (:61-62,82-83,111-112,
137-138,167-168), `shops.service.ts` (:62-63,91-92) y `user-dto.mapper.ts`
(:33-34,52-53,78-79) son **passthrough puro**: `created_at: record.createdAt,
updated_at: record.updatedAt`, sin lógica. Sus specs (`categories.service.
spec.ts`, `shops.service.spec.ts`, `users.service.spec.ts`, `user-dto.mapper.
spec.ts`) mockean `@safari/db` por completo (precedente CLAUDE.md) y usan
fixtures de fecha fija (`NOW`, `WRITE_NOW`, `FIXED_DATE`) **iguales para
`createdAt` y `updatedAt`** — no ejercitan ni el trigger ni `clock.ts`.
**Radio de impacto: cero** en la capa de API.

**`services/scraper-worker/`** — cero referencias a `created_at`/`updated_at`
en todo el árbol (grep vacío, excluido `.venv`). El pipeline no las toca (y
ya está roto por otra razón — tabla `productos` inexistente, ver
`CLAUDE.md`/US-6 —, así que tampoco es un consumidor activo hoy).

**`db/seed.sql` y `db/generate-seed.mjs`** — cero ocurrencias de
`created_at`/`updated_at` en ambos archivos (grep vacío). Confirma
literalmente lo que dice `CLAUDE.md`: el seed no inserta esas columnas; las
filas nacen con el `DEFAULT now()` de la columna en el momento del último
`just db-up`, así que el conteo de bytes de contratos HTTP nunca las ve como
divergencia por fila.

**Conclusión de la auditoría:** el único radio de impacto real de cualquier
opción de CA-1 son los tres archivos de test de `packages/db` citados arriba
(comentarios a actualizar, no asserts a reparar) más la propia US-34 (el
insumo de diseño, ya declarado como dependencia dura). No hay ningún
consumidor oculto en API, scraper o seed.

## Affected Areas

- `db/schema.sql:480-500` — función y triggers; el cambio de CA-1 vive aquí
  (Opción A: sin cambio de DDL más allá del comentario que CA-3/US-34-CA-3
  exige; Opción B: retira las 5 líneas de `CREATE TRIGGER` — la función
  puede quedar sin uso o retirarse también).
- `packages/db/prisma/schema.prisma:81-82,100-101,183-184,240-241,258-259` —
  los 5 pares de columnas de las tablas con trigger; posible anotación
  `dbgenerated("now()")` en `createdAt` si se elige Opción A.
- `packages/db/README.md:94-100` — pasos de re-introspección; necesitaría una
  línea nueva si Opción A exige reaplicar un `dbgenerated(...)` manual además
  de los renombres de PascalCase.
- `packages/db/src/clock.ts` — cabecera a documentar (CA-3): qué columnas
  afecta hoy `_setNowProvider` (ninguna `created_at`; `updated_at` de
  `types`/`tags`/`manufacturers`; `consumedAt` de `auth-tokens`) y qué pasaría
  a afectar según la opción elegida.
- `packages/db/src/repositories/{products,categories,shops,users}.
  repository.ts` — si se elige Opción B, cada `updateX` gana
  `updatedAt: now()` explícito (patrón ya usado en `types`/`tags`/
  `manufacturers`); `users.repository.ts:293-294` (creación anidada de
  `profiles`) necesitaría el mismo tratamiento para el `updateProfile` que
  hoy no existe como función propia.
- `packages/db/src/repositories/{categories,products,shops}.integration.
  test.ts` — nuevo test del invariante CA-2 (`updated_at >= created_at` sobre
  una fila creada y luego actualizada); los comentarios que evitan
  create-vs-update quedan desactualizados (mención en Riesgos).
- `docs/product/33-contenido-configuracion-postgres/34-esquema-capa-datos-
  contenido.md` — CA-3 de US-34 hereda literalmente la decisión de CA-1 de
  esta US para las 8 tablas nuevas.

## Approaches

1. **Opción A — alinear `createdAt` a `dbgenerated("now()")` (ambas columnas
   desde Postgres)**
   - **DDL:** ninguno nuevo en `db/schema.sql` — las columnas ya declaran
     `DEFAULT now()` a nivel de columna (p. ej. `:77-78` para `shops`,
     `:388-389` para `products`); lo que cambia es que Prisma deje de
     enviar un valor calculado en el cliente para `created_at` en el
     `INSERT`. Solo se toca el comentario del bloque de triggers (CA-1 de
     US-32 exige declarar la política).
   - **Consecuencia en Prisma:** `prisma db pull` seguirá introspeccionando
     `DEFAULT now()` como `@default(now())` (su mapeo estándar) — **no**
     como `dbgenerated("now()")` automáticamente. Lograr que el motor de
     Prisma omita el parámetro y deje el valor al `DEFAULT` de Postgres
     exige **anotar a mano** `@default(dbgenerated("now()"))` en `createdAt`
     de las 5 (y luego 13) tablas, cada vez que se re-introspeccione — un
     paso de mantenimiento nuevo, no documentado hoy en
     `packages/db/README.md:94-100` (que solo habla de renombrar
     PascalCase/`@map`).
   - **Auditoría de consumidores:** no rompe nada de lo encontrado en el
     paso 4 (nadie compara create-vs-update hoy); los tres comentarios de
     test quedan obsoletos pero no rojos.
   - **Tablas nuevas de US-34:** las 8 entrarían con el mismo trigger
     (bloque de 5 pasa a 13) y la misma anotación manual `dbgenerated` en
     `createdAt`. **Entrenchea** el patrón de trigger — la política que
     hoy solo gobierna 5 tablas pasaría a gobernar 13, mientras
     `types`/`tags`/`manufacturers` (3 tablas) seguirían con el patrón de
     repositorio. **Dos políticas conviven igual**, solo que el bloque de
     trigger crece más que el de repositorio.
   - **`_setNowProvider`:** sigue sin tener efecto sobre `created_at` ni
     `updated_at` de las tablas con trigger (ambas columnas quedan 100% en
     el reloj de Postgres, fuera del alcance de `clock.ts`).
   - Pros: cero cambio de DDL; el patrón por defecto de la introspección
     hace el trabajo casi solo; menor superficie de repositorio tocada
     (ningún `update*` cambia).
   - Cons: introduce un tercer tipo de "renombre manual que hay que
     recordar" tras cada `prisma db pull` (además de PascalCase/`@map`),
     sin documentarlo hoy; no converge con el patrón de Épico 26 (decisión
     9); las 13 tablas de entidad de US-34 heredan una política distinta de
     `types`/`tags`/`manufacturers`.
   - Effort: Bajo (DDL) / Medio (disciplina de introspección nueva, sin
     tooling que la fuerce).

2. **Opción B — retirar el trigger, fijar ambas columnas desde `clock.ts` en
   los repositorios**
   - **DDL:** retirar las 5 sentencias `CREATE TRIGGER` de
     `db/schema.sql:488-500` (y, si queda sin otro uso, la función
     `tocar_updated_at()` de `:480-486` también, o dejarla comentada como
     tombstone — a decidir en `sdd-propose`).
   - **Consecuencia en Prisma:** ninguna — `prisma db pull` nunca modeló el
     trigger, así que su ausencia no cambia `schema.prisma` en absoluto.
     Es estrictamente más simple que la Opción A en este eje (cero anotación
     manual nueva).
   - **Auditoría de consumidores:** exige añadir `updatedAt: now()`
     explícito a cada `updateX` de `products`, `categories`, `shops`,
     `users` (y crear o extender el tratamiento de `profiles`, hoy sin
     `update` propio fuera de lo anidado en `users.repository.ts`) —
     mismo patrón ya probado en `types.repository.ts:136`, `tags.
     repository.ts:190`, `manufacturers.repository.ts:217`. Ningún test
     existente se rompe (nadie asume el trigger salvo los tres comentarios
     ya citados, que dejan de ser ciertos y deben reescribirse — parte
     natural del CA-2 de esta US, no un extra).
   - **Tablas nuevas de US-34:** nacen directamente bajo el patrón de
     repositorio, sin necesitar ningún trigger nuevo — **converge las 13 +
     3 tablas de entidad en UNA sola política** (repositorio/`clock.ts`),
     coincidiendo con la decisión 9 del Épico 26 en vez de entrenchear la
     divergencia.
   - **`_setNowProvider`:** pasa a tener efecto sobre `updated_at` de las 5
     tablas (igual que ya lo tiene sobre `types`/`tags`/`manufacturers`).
     `created_at` seguiría sin verse afectado **a menos que** el
     repositorio también fije `createdAt: now()` explícito en `create()` —
     algo que hoy **tampoco** hacen `types`/`tags`/`manufacturers` (ver
     hallazgo del paso 3). Si se quiere simetría total (ambas columnas
     mockeables), hay que decidirlo explícitamente como parte de esta
     opción, no asumirlo.
   - Pros: converge todo el repo en una sola política (la que ya usan 3
     agregados); simplifica el DDL de las 13 tablas nuevas de US-34 (nada
     que decidir sobre triggers); restaura `_setNowProvider` sobre
     `updated_at` de 5 tablas más.
   - Cons: toca 4-5 funciones de repositorio existentes (más superficie de
     cambio que la Opción A); requiere retirar/tombstonear la función SQL
     compartida; el nuevo test de CA-2 debe reescribir los tres comentarios
     "nunca create-vs-update" en `categories`/`products`/`shops`.
   - Effort: Medio (repositorios) / Bajo (DDL, Prisma).

## Recommendation

**Opción B** (retirar el trigger, fijar ambas columnas desde `clock.ts`),
alineado con lo que el propio CA-1 de la US ya insinúa como opción válida y
con lo que el análisis de "insumo del DDL de US-34" (README del Épico 33, R-3)
pide explícitamente: converger en **una** política para las 13 tablas de
entidad que reciben `PUT` reales, en vez de heredar un patrón de trigger que
solo 5 tablas usan hoy y que además exige un paso de mantenimiento manual no
documentado en cada re-introspección (Opción A). Opción B es la que hace
cierto, sin ambigüedad, el argumento de la decisión 9 del Épico 26 (patrón de
repositorio) y el de P-1/R-3 (una sola política de reloj para lo que US-34
va a crear). El costo (tocar 4-5 `updateX`) es bajo y ya tiene precedente
exacto en el propio paquete.

## Risks

- **Fuera de alcance, solo mención:** los tres comentarios extensos en
  `categories.integration.test.ts:279-289`, `products.integration.
  test.ts:518-539` y `shops.integration.test.ts:375-380` que explican por
  qué "nunca create-vs-update" quedan obsoletos tras CA-1 (cualquier
  opción). Reescribirlos es trabajo natural de CA-2 de esta US (el test del
  invariante los reemplaza conceptualmente), no un ítem nuevo de scope.
- **Fuera de alcance, solo mención:** si se elige Opción B, surge la
  pregunta adyacente de si `createdAt` también debería fijarse
  explícitamente desde `clock.ts` en `create()` para ser 100% mockeable
  (hoy ni siquiera `types`/`tags`/`manufacturers` lo hacen). Es una mejora
  de simetría, no algo que CA-1/CA-3 exijan literalmente — declarar la
  decisión en el proponer, no expandir el scope de esta US.
- **Riesgo real, dentro de alcance:** cualquiera de las dos opciones exige
  re-introspección (`prisma db pull` + renombres) y `just db-reset`, ya
  autorizado por el dueño (decisión 6 del Épico 33). El costo real medido
  por el propio repo no es el reset sino la re-introspección grande
  (`packages/db/README.md:94-100`): revisar el diff completo de los 8
  modelos existentes, no solo los 5 tocados.
- **`@updatedAt` de Prisma no es una tercera opción viable** (punto 6 de la
  investigación): no aparece en `schema.prisma` hoy (grep: 0 resultados) y
  no puede coexistir de forma útil con el trigger — al ser `BEFORE UPDATE`
  incondicional, el trigger pisaría cualquier valor que `@updatedAt`
  calculara en el cliente, dejándolo sin efecto salvo que el trigger se
  retire (en cuyo caso `@updatedAt` sería redundante con lo que ya hace
  Opción B, pero con el reloj del motor de Prisma en vez de `clock.ts`,
  perdiendo mockability vía `_setNowProvider` — un retroceso frente a la
  decisión 9 del Épico 26).

## Ready for Proposal

**Sí**, con una decisión a confirmar por el dueño antes de `sdd-propose`:
**Opción B** (recomendada) vs. Opción A. El orquestador debe presentar esta
elección explícitamente — no asumirla — porque el propio texto de CA-1 la
deja abierta ("la alternativa... es válida si el refinamiento la justifica").
Con la respuesta, `sdd-propose` puede fijar el approach sin investigación
adicional: todo el radio de impacto (packages/db, tres tests de integración,
cero blast radius en API/scraper/seed) ya está verificado contra código real.
