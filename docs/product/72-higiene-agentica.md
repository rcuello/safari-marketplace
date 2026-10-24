# US-72 — Higiene agéntica: hooks que protegen los `.env` y `node_modules`

> Hoy nada impide que un agente lea un `.env` real (credenciales de Postgres,
> `SECRET` de next-auth, claves de API) o que parchee a mano un paquete bajo
> `node_modules/`, cambio que se pierde en el próximo `install`. `bingo-flow`,
> otro repo del dueño, resuelve las dos cosas con dos hooks `PreToolUse` y un
> `.editorconfig`. Esta US los trae adaptados a safari.

**Épico:** ninguno (US standalone). Nace del escaneo de `bingo-flow`
(2026-10-24).
**Fecha:** 2026-10-24
**Status:** ✅ Completada (2026-10-24), DA-1..DA-4 en su opción (a)
**Depende de:** ninguna. No toca el `justfile`, `packages/db` ni la API.
**LOC est.:** ~200 (dos hooks de ~100 y ~60 líneas, `settings.json` y
`.editorconfig`)

## Historia

**Como** dueño del repo que trabaja con agentes, **quiero** que el agente no
pueda leer, copiar ni editar un `.env` real ni escribir bajo `node_modules/`,
**para** que un secreto no termine en un transcript y un parche no se pierda
en silencio.

## Contexto — verificado (2026-10-24)

**Los secretos de safari:**

- Hay cinco `.env` reales:
  - `apps/admin/rest/.env`;
  - `apps/api/rest/.env`;
  - `apps/shop/.env`;
  - `packages/db/.env`;
  - `services/scraper-worker/.env`.

  Los cinco están ignorados por git, cada uno por el `.gitignore` de su
  paquete (`git check-ignore -v`: `apps/admin/rest/.gitignore:28`,
  `apps/api/rest/.gitignore:36`, `apps/shop/.gitignore:28`,
  `packages/db/.gitignore:4`, `services/scraper-worker/.gitignore:1`). No
  hay `.gitignore` en la raíz.
- Las plantillas versionadas son `.env.template` (shop, admin/rest,
  admin/graphql) y `.env.example` (api/rest, api/graphql, packages/db,
  scraper-worker).
- `.claude/` de safari está versionado (`git ls-files .claude`: agents,
  commands, output-styles, skills) y **no** tiene `settings.json` ni hooks.
  El repo es del dueño (`origin` = `github.com/rcuello/safari-marketplace`),
  así que añadir configuración de agente al `.claude/` del repo es legítimo:
  no es automatización personal en un repo ajeno.

**Los originales de bingo-flow** (`C:\DevOps\MyGitHub\games\bingo-flow`):

- `.claude/settings.json:3-21` engancha dos hooks `PreToolUse`:
  - `block-env-reads.cjs` con matcher
    `Bash|PowerShell|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep`
    (`:5-10`);
  - `block-node-modules-writes.cjs` con matcher
    `Edit|Write|MultiEdit|NotebookEdit` (`:14-19`).
- `.claude/hooks/pre-tool-use/block-env-reads.cjs`:
  - permite las plantillas `.env.example|.sample|.template|.dist|.defaults`
    (`:30-36`);
  - en el texto de un comando busca el token `/\.env(?:\.[\w-]+)?/gi`
    (`:40`) y globs ofuscados como `.e*` o `.??v` (`:43`);
  - niega emitiendo `permissionDecision: "deny"` con exit 0 (`:83-94`);
  - falla **abierto** ante un error de parseo o interno (`:110`, `:157-158`,
    `:164`).
- `.claude/hooks/pre-tool-use/block-node-modules-writes.cjs`:
  - niega escribir en cualquier ruta con un segmento `node_modules`
    (`:32-40`), solo con herramientas de edición, nunca en Bash (`:11-18`);
  - su mensaje recomienda `pnpm patch` (`:24-28`), que en safari no existe:
    `apps/` usa yarn 1, `apps/api/rest` su propio yarn y `packages/db` npm.
- `.editorconfig` (bingo):

  ```
  [*] charset = utf-8 · end_of_line = lf · indent_style = space
      indent_size = 2 · insert_final_newline = true · trim_trailing_whitespace = true
  ```

**Fricciones verificadas en safari:**

1. **El token de `.env` choca con `process.env`.** En
   `"process.env.GOOGLE_CLIENT_ID"`, el regex de `:40` casa
   `.env.GOOGLE_CLIENT_ID`, que no está en la lista de permitidos, así que el
   hook **negaría** cualquier comando Bash que mencione `process.env`: un
   `grep -rn "process.env"` o un `node -e` que lea una variable. Hoy
   `process.env` aparece en 8 archivos de `apps/api/rest/src` y
   `packages/db/src`, y los agentes lo buscan a menudo (US-70 lo hizo).
   También negaría `grep -n "\.env" justfile`: el `justfile` menciona `.env`
   30 veces. Ver DA-1.
2. **CRLF.** `core.autocrlf=true` a nivel de sistema
   (`Git/etc/gitconfig`), sin `.gitattributes`: la copia de trabajo está en
   CRLF. Un `.editorconfig` con `end_of_line = lf` haría que los editores
   guarden LF sobre archivos que git saca en CRLF. Y `apps/api/rest` ya
   sufre esto: `npx eslint` **sin** `--fix` da 21 175 problemas, de los que
   20 203 son `prettier/prettier: Delete ␍` (medido el 2026-10-24, ver la
   actualización de US-10). Ver DA-2.
3. **Formateadores existentes:**
   - `apps/api/rest/.prettierrc` (`singleQuote`, `trailingComma: all`) y
     `apps/shop/prettier.config.js` (`singleQuote`, `tailwindConfig`) no
     fijan `tabWidth` ni `endOfLine`. Prettier toma `indent_size` del
     `.editorconfig` si existe: con 2 coincide con lo que ya hay.
   - `packages/db/biome.json` fija `indentWidth: 2` y `lineEnding: lf` y no
     lee el `.editorconfig`, así que no hay choque.
   - Python (`services/scraper-worker`) usa 4 espacios: hace falta un bloque
     `[*.py]`.
   - En Markdown, `trim_trailing_whitespace` rompe los saltos de línea duros
     (dos espacios al final), así que hace falta un bloque `[*.md]`.

## Decisiones abiertas para el dueño

> **Confirmadas por el dueño (2026-10-24):** DA-1..DA-4 en su propuesta por defecto.
> **Cambio posterior del mismo día:** el dueño pidió no abrir una US aparte y
> aplicar ya la DA-2 **(b)**: `.gitattributes` con `* text=auto eol=lf`,
> `end_of_line = lf` en `.editorconfig` y la copia de trabajo pasada a LF. Va
> en su propio commit, separado del de los hooks. Ver «Ampliación: fin de
> línea LF» al final.

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Falsos positivos de `process.env` y de las menciones a `.env` en el texto de un comando | **(a)** Exigir que el token no venga precedido de un carácter de identificador: `/(?<![\w$])\.env(?:\.[\w-]+)?/gi`. `apps/shop/.env` y `cat .env` siguen negados; `process.env.X` pasa. Se pierde el caso `config.env`, que safari no usa. **(b)** Copiar el regex tal cual y aceptar los falsos positivos. **(c)** No inspeccionar Bash: solo las herramientas de archivo | **(a)**. Mantiene cubierto el vector que importa (rutas a un `.env`) sin bloquear el trabajo diario. `grep -n "\.env" justfile` seguiría negado (`"\.env` va precedido de `\`, que no es carácter de identificador): es un falso positivo aceptable y el mensaje lo explica |
| DA-2 | `end_of_line` en `.editorconfig` | **(a)** No fijarlo y dejar el fin de línea a git (`autocrlf`). **(b)** `lf` y además un `.gitattributes` con `* text=auto eol=lf` y una renormalización | **(a)**. La (b) es un cambio de todo el repo (renormalizar miles de archivos) y arreglaría también los 20 203 `Delete ␍` de la API, pero es un refactor propio: va en su US, no aquí. Se anota como candidata |
| DA-3 | `AGENTS.md` en la raíz, índice para agentes que no son Claude (bingo lo tiene) | **(a)** No crearlo. **(b)** Crearlo con un puntero a `CLAUDE.md` y a `docs/product/README.md` | **(a)**. Safari solo usa Claude y, para consultas, Gemini vía la skill `agy-gemini`, que no lo necesita. Se crea si aparece otro agente |
| DA-4 | Qué hacer en lugar de editar `node_modules` | **(a)** El mensaje dice: «no se parchea a mano; si hace falta, `patch-package` en el paquete afectado, en una US». **(b)** Instalar ya `patch-package` | **(a)**. Hoy no hay ningún parche; instalar una herramienta sin caso de uso es una abstracción especulativa |

## Scope

**Incluye:**

- `.claude/hooks/pre-tool-use/block-env-reads.cjs`: adaptado de bingo, con
  el regex de DA-1 y el mensaje en español neutral apuntando a
  `.env.example` y `.env.template`;
- `.claude/hooks/pre-tool-use/block-node-modules-writes.cjs`: adaptado, con
  el mensaje de DA-4 y sin mencionar pnpm;
- `.claude/settings.json` nuevo, con los dos matchers de bingo
  (`settings.json:3-21`);
- `.editorconfig` en la raíz: `charset = utf-8`, `indent_style = space`,
  `indent_size = 2`, `insert_final_newline = true`,
  `trim_trailing_whitespace = true`; `[*.py] indent_size = 4`;
  `[*.md] trim_trailing_whitespace = false`; `[justfile] indent_size = 4`
  (sus recetas van sangradas con 4 espacios); **sin** `end_of_line` (DA-2).

`CLAUDE.md` es del dueño y no se toca: si quiere mencionar los hooks en la
sección de reglas, lo decide él a partir del reporte.

**NO incluye:**

- `block_recursive_delete.cjs`, que bingo tampoco engancha por falsos
  positivos (`block-env-reads.cjs:23-27`);
- `.gitattributes` y la renormalización del fin de línea (DA-2 b): candidata
  a US aparte, que además resuelve los 20 203 `Delete ␍` del lint de la API;
- un `.gitignore` en la raíz;
- `patch-package` (DA-4);
- las reglas de `agent-behaviors.md` de bingo: son de su dominio;
- tocar `CLAUDE.md`, el `justfile` o cualquier `.env`.

## Criterios de aceptación

### CA-1 — El hook de `.env` niega lo real y deja pasar las plantillas

Probado alimentando el hook por stdin con eventos JSON, sin depender de la
sesión:

| Evento | Resultado |
|---|---|
| `Read` de `apps/api/rest/.env` | `permissionDecision: "deny"` |
| `Read` de `apps/api/rest/.env.example` y de `apps/shop/.env.template` | sin salida, exit 0 |
| `Bash` con `cat apps/shop/.env` y con `cp packages/db/.env /tmp/x` | deny |
| `Bash` con `grep -rn "process.env" apps/api/rest/src` | sin salida (DA-1 a) |
| `Grep` con `path: services/scraper-worker/.env` | deny |
| stdin vacío o JSON inválido | exit 0, sin salida (falla abierto) |

### CA-2 — El hook de `node_modules` niega solo escrituras

| Evento | Resultado |
|---|---|
| `Edit` de `apps/node_modules/next-auth/react/index.js` | deny, con el mensaje de DA-4 |
| `Read` del mismo archivo | sin salida |
| `Write` de `apps/shop/src/x.ts` | sin salida |

### CA-3 — En una sesión real

Con `.claude/settings.json` cargado, en una sesión de Claude Code:

- pedir al agente `Read apps/api/rest/.env` devuelve el motivo del deny;
- `Read apps/api/rest/.env.example` funciona;
- `grep -rn "process.env" packages/db/src` funciona.

### CA-4 — `.editorconfig` sin cambios de formato

`yarn lint` del shop, `npx biome check .` de `packages/db` y `npx eslint` de
la API (sin `--fix`) dan **los mismos** conteos antes y después de añadir el
`.editorconfig`. Ningún archivo cambia por el solo hecho de crearlo
(`git status` muestra solo los archivos nuevos).

## Escenarios Gherkin

```gherkin
Feature: Higiene agentica
  Scenario: CA-1 — el agente no lee un .env real
    Given el hook block-env-reads enganchado en .claude/settings.json
    When el agente pide Read de apps/api/rest/.env
    Then la herramienta se niega con el motivo del hook

  Scenario: CA-1 — las plantillas siguen disponibles
    When el agente pide Read de apps/api/rest/.env.example
    Then la lectura funciona

  Scenario: CA-1 — process.env no es un .env
    When el agente corre grep -rn "process.env" packages/db/src
    Then el comando se ejecuta

  Scenario: CA-2 — node_modules no se edita a mano
    When el agente pide Edit de un archivo bajo node_modules
    Then la herramienta se niega y sugiere patch-package en una US
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `.claude/settings.json` | nuevo: los dos `PreToolUse` |
| `.claude/hooks/pre-tool-use/block-env-reads.cjs` | nuevo, adaptado (DA-1) |
| `.claude/hooks/pre-tool-use/block-node-modules-writes.cjs` | nuevo, adaptado (DA-4) |
| `.editorconfig` | nuevo (DA-2) |
| `AGENTS.md` | solo si DA-3 = (b) |

## Definición de Done

- [x] DA-1..DA-4 confirmadas por el dueño y anotadas aquí.
- [x] CA-1 y CA-2: cada fila con el comando `echo '<json>' | node <hook>` y
  su salida pegada.
- [x] CA-3: la respuesta real de la sesión a los tres pedidos.
- [x] CA-4: los tres conteos de lint antes y después, y `git status`.
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **Este agente va a quedar sujeto a los hooks que instala.** Prueba CA-1 y
  CA-2 por stdin **antes** de crear `settings.json`. Una vez creado, el
  propio agente ya no podrá leer los `.env` reales: si una verificación los
  necesita, hazla antes o pídesela al dueño.
- **El formato del evento:** `{"tool_name":"Read","tool_input":{"file_path":"…"}}`,
  y para Bash `{"tool_name":"Bash","tool_input":{"command":"…"}}`. La salida
  de deny es el JSON de `block-env-reads.cjs:83-94`.
- **Portabilidad:** los hooks son Node puro y se invocan como
  `node "${CLAUDE_PROJECT_DIR}/…"`, igual que en bingo; en Windows funciona
  con el Node del sistema (v22). No uses Bash para el hook.
- **Falla abierto**, como el original: un hook roto no debe bloquear la
  sesión. No cambies esa decisión.
- **CRLF:** los `.cjs` nuevos se pueden escribir en LF; git los normaliza
  igual que el resto.
- Menciona en el reporte la candidata a US aparte: `.gitattributes` +
  renormalización (DA-2 b).

## Evidencia (2026-10-24)

**Implementación:**

- `.claude/hooks/pre-tool-use/block-env-reads.cjs`: es el de bingo-flow con
  dos cambios. El `TOKEN_RE` pasa a `/(?<![\w$])\.env(?:\.[\w-]+)?/gi`
  (DA-1 a), y los mensajes están en español neutral y apuntan a las
  plantillas. El resto es igual: las plantillas permitidas, `GLOB_RE`, el
  esquema de deny y que falla abierto.
- `.claude/hooks/pre-tool-use/block-node-modules-writes.cjs`: el mensaje de
  DA-4 (a) menciona `yarn install`/`npm install` y `patch-package` en una
  US, sin `pnpm`.
- `.claude/settings.json`: los dos matchers de bingo
  (`settings.json:3-21`), sin cambios.
- `.editorconfig`: `[*]`, `[*.py]`, `[*.md]` y `[justfile]`, sin
  `end_of_line` (DA-2 a).
- DA-3 (a): no se creó `AGENTS.md`.

**CA-1 y CA-2**, con los hooks alimentados por stdin antes de crear
`settings.json` (un script de prueba en el scratchpad de la sesión lanza
`node <hook>` con cada evento):

```
CA-1 | Read apps/api/rest/.env                                        → exit 0 · deny: Bloqueado: 'apps/api/rest/.env' es un archivo de secretos protegido. …
CA-1 | Read apps/api/rest/.env.example                                → exit 0 · sin salida
CA-1 | Read apps/shop/.env.template                                   → exit 0 · sin salida
CA-1 | Read C:\…\packages\db\.env (Windows)                           → exit 0 · deny: Bloqueado: 'C:\DevOps\MyGitHub\safari-marketplace\packages\db\.env' es un archivo de secretos protegido. …
CA-1 | Bash cat apps/shop/.env                                        → exit 0 · deny: Bloqueado: el comando menciona un archivo de secretos protegido …
CA-1 | Bash cp packages/db/.env /tmp/x                                → exit 0 · deny
CA-1 | Bash cat .env                                                  → exit 0 · deny
CA-1 | Bash grep -rn "process.env" apps/api/rest/src                  → exit 0 · sin salida
CA-1 | Bash node -e "console.log(process.env.PORT)"                   → exit 0 · sin salida
CA-1 | Bash cat apps/shop/.env.template                               → exit 0 · sin salida
CA-1 | Bash cat apps/shop/.e* (glob ofuscado)                         → exit 0 · deny
CA-1 | Bash grep -n "\.env" justfile (falso positivo aceptado)        → exit 0 · deny
CA-1 | Grep path services/scraper-worker/.env                         → exit 0 · deny: Bloqueado: buscar dentro de un archivo de secretos expone su contenido. …
CA-1 | Grep pattern "process.env" path src                            → exit 0 · sin salida
CA-1 | Glob **/.env                                                   → exit 0 · deny: Bloqueado: buscar archivos de secretos protegidos. …
CA-1 | stdin vacío                                                    → exit 0 · sin salida
CA-1 | JSON inválido                                                  → exit 0 · sin salida
CA-2 | Edit apps/node_modules/next-auth/react/index.js                → exit 0 · deny: Bloqueado (US-72): escribir a mano bajo node_modules/. …
CA-2 | Edit C:\…\apps\node_modules\next-auth\react\index.js (Windows) → exit 0 · deny
CA-2 | Read apps/node_modules/next-auth/react/index.js                → exit 0 · sin salida
CA-2 | Write apps/shop/src/x.ts                                       → exit 0 · sin salida
CA-2 | JSON inválido                                                  → exit 0 · sin salida
```

**CA-3**, en la misma sesión de Claude Code, con `settings.json` ya creado.
Los hooks se aplicaron sin reiniciar:

```
Read apps/api/rest/.env
  → PreToolUse:Read hook error: Bloqueado: 'C:\DevOps\MyGitHub\safari-marketplace\apps\api\rest\.env' es un archivo de secretos protegido. El hook de seguridad del proyecto (US-72) bloquea leer, editar, copiar o cargar un .env real. Para configuración sin secretos usa la plantilla (.env.example o .env.template); si hace falta un valor real, pídeselo al dueño.
Read apps/api/rest/.env.example
  → 1 APP_NAME=Marvel / 2 PORT=9000 / 3 DEFAULT_CURRENCY=USD
grep -rn "process.env" packages/db/src
  → packages/db/src/client.ts:8:  const connectionString = process.env.DATABASE_URL; …
ls -l apps/shop/.env   (vía Bash, comando inocuo a propósito)
  → PreToolUse:Bash hook error: Bloqueado: el comando menciona un archivo de secretos protegido …
```

**CA-4**, antes y después del `.editorconfig`:

```
apps/shop       yarn lint                                          → ✔ No ESLint warnings or errors   /   ✔ No ESLint warnings or errors
packages/db     npx biome check .                                  → Checked 77 files · Found 97 errors · Found 1 info   /   idéntico
apps/api/rest   npx eslint "{src,apps,libs,test}/**/*.ts" (sin --fix) → ✖ 21175 problems (21123 errors, 52 warnings)   /   idéntico (diff vacío)
git status --short  →  ?? .claude/hooks/   ?? .editorconfig   (y luego ?? .claude/settings.json)
```

`packages/db` ya tenía 97 errores de `biome`. En la salida se ven
sobre todo diferencias de fin de línea (`␍`) y de formato; no los causa
esta US y no se tocan. Es la misma familia que los 20 203 `Delete ␍` de la
API.

**Efecto para quien trabaje con agentes desde ahora:**

- Un comando de Bash que mencione `.env` como ruta queda negado. Eso incluye
  un `sed` o un heredoc que solo escribe ese texto en un documento: para
  esos casos se usan las herramientas de edición, que solo miran la ruta.
- Las verificaciones que necesiten un valor real se le piden al dueño. Por
  ejemplo, la marca de tiempo del `.env` del shop que usó US-70 ya no puede
  sacarla el agente.

La candidata a US aparte que anotaba aquí (DA-2 b) se ejecutó en esta misma
US a petición del dueño: ver la sección siguiente.

## Ampliación: fin de línea LF (DA-2 b, 2026-10-24)

**Qué cambió:**

- `.gitattributes` nuevo en la raíz: `* text=auto eol=lf` y los binarios
  habituales (imágenes, fuentes, pdf, zip) marcados como `binary`.
- En `.editorconfig`, `end_of_line = lf`.
- La copia de trabajo pasó a LF sin `git reset` ni `checkout`, porque había
  cambios sin commit de esta US. Un script en el scratchpad de la sesión
  convierte en el sitio solo los archivos que `git ls-files --eol` marca
  `i/lf w/crlf`; no toca binarios ni archivos sin versionar.

**Antes:** el contenido del repo ya estaba todo en LF. No había ningún
`i/crlf`: `core.autocrlf=true` lo normalizaba al hacer commit. El problema
estaba solo en la copia de trabajo de Windows:

```
3891 i/lf w/lf
 411 i/lf w/crlf      ← 137 apps/api, 111 openspec/changes, 62 packages/db, 52 docs/product, 14 openspec/specs, 13 apps/shop, 6 apps/admin, …
  91 i/-text w/-text  (binarios)
  43 i/none w/none
```

**Conversión:**

```
411 archivos i/lf w/crlf convertidos; 126152 bytes \r quitados
```

**Después:**

```
git ls-files --eol   →  4302 i/lf w/lf · 91 i/-text w/-text · 43 i/none w/none   (ningún w/crlf)
git add --renormalize .  →  no cambia nada del contenido versionado (solo quedan los cambios reales de esta US)
git status --short   →  M docs/product/72-higiene-agentica.md · M docs/product/README.md · ?? .claude/hooks/ · ?? .claude/settings.json · ?? .editorconfig · ?? .gitattributes
```

El primer `git status` tras la conversión listó los 411 archivos como `M`:
era el caché de estado de git, que se refrescó con el `--renormalize`. El
contenido versionado de esos archivos no cambió.

**Efecto en el lint y en los tests:**

```
apps/api/rest   npx eslint (sin --fix)  →  21175 problems (21123 errors, 52 warnings)  ⇒  972 problems (920 errors, 52 warnings)
packages/db     npx biome check .       →  97 errors · 1 info                          ⇒  93 errors · 1 info
apps/shop       yarn lint               →  ✔ No ESLint warnings or errors (sin cambios)
cd apps/api/rest && npx jest            →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
just db-check                           →  Test Files  32 passed (32) / Tests  412 passed (412)
```

Los 972 problemas que quedan en la API y los 93 de `biome` ya no son de fin
de línea. Corrección: no eran «código heredado», sino sobre todo código de
las US del Épico 46 que nunca pasó por el formateador. El dueño pidió no
dejarlos pendientes, así que se resolvieron el mismo día en commits
aparte:

```
API (eslint)   920 prettier/prettier (97 archivos, --fix) + 52 no-unused-vars  ⇒  0 problemas
packages/db    59 archivos de formato + 32 organizeImports (biome --write) + 3 errores y 1 info a mano  ⇒  0
```

**Incidencia:** al terminar, la API (9001) y el admin (3002) del dueño, que
corrían en modo dev, ya no estaban vivos. La causa probable, aunque no
confirmada, es la recompilación en caliente tras reescribirse 137 archivos
de la API y 6 del admin. Se relanzan con `just api-dev` y `just admin-dev`.

**Para quien clone o actualice:** como el contenido versionado no cambia,
un `git pull` no trae diferencias de fin de línea. Una copia de trabajo
existente en CRLF se queda así hasta que se vuelva a sacar cada archivo. Se
normaliza de una vez con `git rm --cached -r . && git reset --hard`, que
solo es seguro con el árbol limpio.
