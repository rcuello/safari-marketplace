# Tasks: entidad y DTO de `become-seller` alineados con el contrato real (US-45)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~375-395 (recalculo del gatekeeper; no las ~364 del design) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR (una corrección atómica; la red del spec es evidencia de CA-3) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

Tarea con más riesgo de sobrepasar 400: **4.2/4.3/4.4** (spec) — `toEqual` de
24 nombres (~26) + `AssertSameKeys` (~12) + fixture (~8) + 3 fixtures de
`create()` reescritos ⇒ presupuestar **+75-85**, no el +60 del design.
Margen real bajo 400: **~5-25 líneas**, no ~36.

**Palanca de compresión si el diff se acerca a 400: SOLO prosa de
comentarios.** Nunca quitar el prefijo `BecomeSeller` de una clase nueva
para ahorrar caracteres — reintroduce la colisión `Banner` de D-9 (D-9 en
`design.md`) y ni la red de tipos ni CA-2 lo detectan (CA-2 resuelve por
`$ref`, agnóstico al nombre; el daño sale en `/api/types`, fuera de este
módulo).

## Fase 0 — Captura "antes" (obligatoria primero)

- [x] 0.1 Confirmar `just api-dev` y `just db-up` arriba. Capturar
      `curl -s http://localhost:9001/api/became-seller` en el scratchpad
      (`antes.json`); confirmar `size_download == 11452`.
- [x] 0.2 Capturar `GET /docs-json` (node -e, sin `jq`): `requestBody` con
      props `['id','page_options','language','missions']`; objeto interno
      con 12 props; `banner` → `$ref Attachment`. Guardar la salida cruda.
- [x] 0.3 Confirmar baseline: `npx jest` (10/290), `just db-check` (12/228),
      `just build-api` verde — reusar cifras de `exploration.md` si el
      entorno no cambió desde entonces; si no, re-medir.

## Fase 1 — Entidad (`entities/become-seller.entity.ts`)

- [x] 1.1 Borrar el `import { Type } from 'class-transformer'` de la línea 1
      (huérfano; el design no lo menciona).
- [x] 1.2 Declarar las 13 clases del inventario de `design.md` (Interfaces /
      Contracts), en ese orden de dependencias.
- [x] 1.3 `CommissionItem` pasa a `class` (no `interface`), `id: number`
      (el JSON trae `79`, no string — el design nunca lo tipó);
      `max_balance: string`; `image: BecomeSellerImage`; `created_at`/
      `updated_at: string` con un comentario en la clase explicando que son
      texto plano dentro del `jsonb` de `commissions`, a diferencia de
      `BecomeSellerEnvelope` (columnas Prisma tipadas `Date`) — para que un
      lector futuro no lo "corrija" a `CoreEntity`. `CommissionItem` NO
      extiende `CoreEntity`.
- [x] 1.4 `BecomeSellerOptions`, 24 claves, en este orden y tipo exacto
      (derivado de `become-seller.json`, sin adivinar):

      | Clave | Tipo |
      |---|---|
      | defaultCommissionRate | number |
      | defaultCommissionDetails | string |
      | banner | BecomeSellerBanner |
      | sellingStepsTitle | string |
      | sellingStepsDescription | string |
      | sellingStepsItem | SellingStepItem[] |
      | userStoryTitle | string |
      | userStoryDescription | string |
      | purposeTitle | string |
      | purposeDescription | string |
      | purposeItems | BusinessPurposeItem[] |
      | commissionTitle | string |
      | commissionDescription | string |
      | isMultiCommissionRate | boolean |
      | dashboard | BecomeSellerShowcase |
      | guidelineTitle | string |
      | guidelineDescription | string |
      | guidelineItems | BecomeSellerGuidelineItem[] |
      | faqTitle | string |
      | faqDescription | string |
      | faqItems | FaqItems[] |
      | contact | BecomeSellerContact |
      | sellerOpportunity | BecomeSellerShowcase |
      | userStories | BecomeSellerUserStory[] |

- [x] 1.5 `BecomeSellerGuidelineItem.link`: único
      `@ApiProperty({ type: String, nullable: true })` del change — es el
      primer `@ApiProperty` de toda la API (`grep -rln ApiProperty
      apps/api/rest/src/` hoy no devuelve nada). Contingencia acotada: si
      tras `just build-api` el plugin ignora o pisa el `type`, retirar el
      decorador y anotarlo en el reporte — ninguna CA depende de `nullable`.
- [x] 1.6 Prefijo `BecomeSeller` solo en clases NUEVAS (`BecomeSellerImage`,
      `BecomeSellerBanner`, `BecomeSellerShowcase`,
      `BecomeSellerGuidelineItem`, `BecomeSellerUserStory`,
      `BecomeSellerContact`, `BecomeSellerEnvelope`); las existentes
      conservan nombre. No renombrar `CommissionItem` (ya libre en
      `components.schemas`).

## Fase 2 — DTO (`dto/create-become-seller.dto.ts`)

- [x] 2.1 Reemplazar `OmitType(BecomeSeller, …)` por la clase a mano:
      `{ language?: string; page_options: BecomeSellerOptions; commissions:
      CommissionItem[] }`, importando ambas clases de la entidad.

## Fase 3 — Servicio (`become-seller.service.ts`)

- [x] 3.1 Borrar `BecomeSellerWriteBody` y los dos `as unknown as`.
- [x] 3.2 Declarar **3 guardas** a nivel de módulo, parámetro `unknown`
      (colapso del gatekeeper: las dos guardas de escritura se funden en
      una sola):
      `_isBecomeSellerOptions(value): value is BecomeSellerOptions`,
      `_isCommissionList(value): value is CommissionItem[]`,
      `_isJsonPayload(value): value is Prisma.InputJsonObject |
      Prisma.InputJsonArray`.
- [x] 3.3 `create()` lee `dto.page_options`/`dto.commissions`/`dto.language`
      directo del DTO tipado; el spread condicional usa `_isJsonPayload`
      para acotar antes de pasar a `updateBecomeSeller`.
- [x] 3.4 `_toEnvelope()`: guardas de lectura con
      `_isBecomeSellerOptions(row.pageOptions)` /
      `_isCommissionList(row.commissions)`. Si fallan, lanzar
      `InternalServerErrorException` (misma clase que la guarda de fila
      ausente, línea de código existente) con el mensaje: `'La fila de
      `become_seller` tiene `page_options`/`commissions` con forma
      inesperada.'`. El literal de retorno queda sin ningún `as`.
- [x] 3.5 Reescribir el comentario `:12-23`: documentar el límite `jsonb`
      (`Prisma.JsonValue`/`InputJsonValue` no son subtipo de una clase
      porque a la clase le falta el índice de string), que las guardas
      estrechan con comprobación real de runtime, y que `create()` lee del
      DTO tipado. **No repetir la subcadena `as unknown as`** en ningún
      tiempo verbal ni negada (D-5) — el grep de cierre de CA-3 la caza
      también en comentarios.
- [x] 3.6 Disclosure (no acción de código): anotar en el reporte final / PR
      que la guarda de escritura **elimina un 500 existente** — hoy
      `page_options: null` se reenvía y Prisma lanza; tras la guarda la
      clave se omite y el `POST` responde 201. Esto NO está ratificado por
      el owner del producto; presentarlo como delta abierto, no como
      decisión cerrada. Si en 3.2-3.3 se encuentra una forma de preservar
      el 500 actual sin reintroducir un escape de tipos, preferible —
      anotarlo, no es obligatorio.

## Fase 4 — Spec (`become-seller.service.spec.ts`)

- [x] 4.1 Borrar `createDto()` y los `as never as`; los tests de `create()`
      construyen su fixture con
      `{ language: json.page_options.language, page_options:
      json.page_options.page_options, commissions: json.commissions }`
      (compila sin cast, D-11). `makeRecord()` no cambia.
- [x] 4.2 Añadir la red D-10: `KeyDrift<T,K> = Exclude<keyof T,K> |
      Exclude<K,keyof T>`, `AssertSameKeys<T,K> = [KeyDrift<T,K>] extends
      [never] ? true : KeyDrift<T,K>`; 4 `const` (`BecomeSeller` vs
      `keyof typeof becomeSellerJson`, `BecomeSellerEnvelope` vs
      `keyof typeof becomeSellerJson.page_options`, `BecomeSellerOptions`
      vs `keyof typeof becomeSellerJson.page_options.page_options`,
      `CreateBecomeSellerDto` vs `'language'|'page_options'|'commissions'`).
      Prohibido `satisfies` (TS ^4.7.4).
- [x] 4.3 Añadir `it()` de runtime:
      `Object.keys(becomeSellerJson.page_options.page_options)` con
      `toHaveLength(24)` y `toEqual([...los 24 nombres de 1.4 en ese
      orden...])`.
- [x] 4.4 Reescribir los 3 fixtures de `create()` existentes para construir
      desde el JSON real sin cast (ver 4.1).

## Fase 5 — Verificación (DoD literal)

- [x] 5.1 `/docs-json` después: mismo `node -e` de 0.2. Verificar
      `requestBody` (`language`/`page_options`/`commissions`, `required`
      sin `id` ni `language`), `responses.200`/`201` (top-level
      `page_options`/`commissions`; `page_options` en 5 claves), objeto
      interno 24 props, `banner` 9 props sin `Attachment`, `max_balance`
      `type:"string"`, `link.nullable === true`. **Aserción extra
      obligatoria**: `components.schemas.Banner` (el schema global
      preexistente de `types/entities/type.entity.ts`) sigue con sus 4
      propiedades originales y `Type.banners` sigue con `$ref` a él —
      evidencia de que D-9 no corrompió `/api/types`.
      RESULTADO: todo confirmado contra `/docs-json` reconstruido (API
      reiniciada tras `just build-api`, ver reporte final).
- [x] 5.2 `grep -rn missions apps/api/rest/src/become-seller/` vacío;
      `grep -n "as unknown as\|as any\|ts-ignore\|ts-expect-error"
      apps/api/rest/src/become-seller/become-seller.service.ts` vacío
      (confirma que 3.5 no reintrodujo la frase).
      HALLAZGO: el grep de `missions` literal NUNCA puede estar vacío
      mientras el código use correctamente `commissions` — `missions` es
      subcadena de `commissions` (com+missions). Se verifica en su lugar
      con límite de palabra (`grep -rnw missions ...`, vacío) para
      confirmar que no sobrevive ningún campo llamado literalmente
      `missions`; el grep sin `-w` solo encuentra las apariciones
      correctas de `commissions`. El segundo grep (escapes de tipos) sí
      dio vacío tal cual está escrito en el DoD.
- [x] 5.3 CA-3 rojo/verde: renombrar `commissions`→`missions` en el DTO,
      correr `npx jest`, pegar el `error TS2322` real; restaurar, pegar
      verde.
- [x] 5.4 `curl` `GET /api/became-seller` después: `size_download == 11452`
      + `deepStrictEqual` contra 0.1 excluyendo `created_at`/`updated_at`
      del envoltorio.
- [x] 5.5 `POST` con el body real del admin → 201; `GET` posterior lo
      refleja; restaurar la fila con `psql` (patrón US-44 CA-2).
- [x] 5.6 `cd apps/api/rest && npx jest` verde, ≥ 10 suites / ≥ 291 tests.
- [x] 5.7 `just build-api` verde (único punto donde corre el plugin CLI de
      Swagger; `ts-jest` nunca lo ejercita).
- [x] 5.8 `just verify` con `/api/settings` en 5503 B.
- [x] 5.9 `just db-check` idéntico a la base: 12 archivos / 228 tests.
- [x] 5.10 `git diff --stat` acotado a `apps/api/rest/src/become-seller/`.
- [x] 5.11 Actualizar `docs/product/45-entidad-become-seller-desalineada.md`:
      `Status: Implementada` + LOC real.

## Fase 6 — Reporte / PR

- [x] 6.1 PR description: incluir el disclosure de 3.6 (delta 500→201, no
      ratificado), la deuda adyacente ya señalada en el proposal
      (`settings.service.ts:39`, `attachment.entity.ts` sin `file_name`,
      tipos de shop/admin), y confirmar `git diff --stat` acotado.

## Fase 7 — Lote correctivo (post-review, gatekeeper independiente)

No estaba en el plan original de 32 tareas; el defecto lo encontró una
revisión posterior a que las 32 estuvieran completas. Numerada aparte para
no romper la numeración ya cerrada.

- [x] 7.1 Corregir la asimetría de guardas escritura/lectura (DEFECTO 1):
      `create()` pasa a usar `_isBecomeSellerOptions`/`_isCommissionList`
      (las mismas de `_toEnvelope()`), no una guarda más laxa. Resuelto sin
      ningún escape de tipos: predicado ensanchado a la intersección
      `<Clase> & Prisma.InputJson{Object,Array}`, probado primero en un
      mock fiel de `Prisma.InputJsonValue` en el scratchpad, después contra
      los tipos reales (`tsc --noEmit` limpio). `_isJsonPayload` eliminada
      (quedó sin uso).
- [x] 7.2 Añadir test de regresión en `become-seller.service.spec.ts`
      (`create()`): `commissions` como objeto y `page_options` como array
      NO se reenvían a `updateBecomeSeller`. Fixture construida con
      `JSON.parse(JSON.stringify(...))`, sin ningún cast de tipos.
- [x] 7.3 Demostración en vivo del exploit cerrado: `POST` con
      `commissions` como objeto contra la API reconstruida → 201, `GET`
      posterior → 200 (ya no 500 permanente), fila restaurada por `psql`.
- [x] 7.4 Corregir el disclosure de delta de runtime (DEFECTO 2) en
      `apply-progress.md`: separar el caso `null` (antes 500) del caso
      escalar/forma incorrecta (antes 201 con fila corrupta), y añadir la
      dirección de lectura no divulgada (fila ya corrupta: antes 200 con
      basura, ahora 500). Texto original conservado para el rastro de
      auditoría.
- [x] 7.5 Corregir la razón de `satisfies` (DEFECTO 3) en el comentario de
      `become-seller.service.spec.ts`: el binario instalado es
      `typescript@4.9.5` (sí trae `satisfies`); la razón real es que el
      rango declarado `^4.7.4` permite instalar un `4.7.x` sin él. Sin
      cambiar la decisión de no usarlo.
- [x] 7.6 Señalar (sin revertir) la edición de la prosa del DoD del US-45
      hecha en el primer lote (el matiz de `missions`⊂`commissions`) —
      pertenece al owner del documento, no es una decisión unilateral del
      ejecutor.
- [x] 7.7 Re-verificar: grep de todo el módulo (no solo el servicio) vacío;
      `tsc --noEmit` limpio; `npx jest` verde (≥ 10/291, recuento real
      reportado); `just build-api` verde; `GET` en vivo 11452B +
      `deepStrictEqual` sobre la API reconstruida y reiniciada de verdad;
      `just verify`; `git diff --stat` reportado con honestidad aunque
      supere 400 (permitido por `size:exception`, sin comprimir).
- [x] 7.8 Actualizar `apply-progress.md` (fusión, no sobrescritura),
      `state.yaml` (bloque `apply`) y la LOC del doc del US.
