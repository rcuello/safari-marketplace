# safari-marketplace — tareas del monorepo
#
# Uso:   just              -> lista las tareas
#        just setup        -> deja el proyecto listo desde cero
#        just api-dev      -> arranca la API (terminal 1)
#        just shop-dev     -> arranca la tienda (terminal 2)
#        just admin-dev    -> arranca el admin (terminal 3)
#        just verify       -> comprueba que los tres responden
#
# Requiere: Node 20+, yarn 1 (`npm i -g yarn`), Python 3.11+ (solo scraper).
# Detalle de cada paso y problemas conocidos: apps/README.md

set shell := ["bash", "-uc"]

# Puertos. Override:  just API_PORT=9002 api-dev   |   API_PORT=9002 just api-dev
API_PORT   := env_var_or_default("API_PORT", "9001")
SHOP_PORT  := env_var_or_default("SHOP_PORT", "3003")
ADMIN_PORT := env_var_or_default("ADMIN_PORT", "3002")

# Lista las tareas disponibles
default:
    @just --list


# ─────────────────────────── setup ───────────────────────────

# Deja el proyecto listo desde cero (env + dependencias). ~15 min la primera vez
[group('setup')]
setup: env install
    @echo ""
    @echo "Listo. Abre tres terminales y ejecuta:"
    @echo "   just api-dev     -> http://localhost:{{API_PORT}}/api"
    @echo "   just shop-dev    -> http://localhost:{{SHOP_PORT}}"
    @echo "   just admin-dev   -> http://localhost:{{ADMIN_PORT}}"

# Crea los .env desde las plantillas (no pisa los existentes)
[group('setup')]
env:
    #!/usr/bin/env bash
    set -euo pipefail
    crear() {
      if [ -f "$2" ]; then
        echo "  = $2 ya existe, no se toca"
      else
        cp "$1" "$2"
        echo "  + $2 creado"
      fi
    }
    crear apps/shop/.env.template       apps/shop/.env
    crear apps/admin/rest/.env.template apps/admin/rest/.env
    crear apps/api/rest/.env.example    apps/api/rest/.env

    # Placeholders del shop que las plantillas dejan sin valor util
    if ! grep -q '^SECRET=.\+' apps/shop/.env; then
      SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      sed -i "s|^SECRET=.*|SECRET=${SECRET}|" apps/shop/.env
      echo "  * SECRET generado en apps/shop/.env"
    fi
    sed -i 's|^NEXT_PUBLIC_ADMIN_URL=.*|NEXT_PUBLIC_ADMIN_URL="http://localhost:{{ADMIN_PORT}}"|' apps/shop/.env
    sed -i 's|^NEXTAUTH_URL=.*|NEXTAUTH_URL=http://localhost:{{SHOP_PORT}}|'                      apps/shop/.env

    just set-api-port

# Sincroniza el puerto de la API en los tres .env (usar si el puerto esta ocupado)
[group('setup')]
set-api-port:
    #!/usr/bin/env bash
    set -euo pipefail
    sed -i 's|^PORT=.*|PORT={{API_PORT}}|'                       apps/api/rest/.env
    sed -i 's|localhost:[0-9]\+/api|localhost:{{API_PORT}}/api|' apps/shop/.env
    sed -i 's|localhost:[0-9]\+/api|localhost:{{API_PORT}}/api|' apps/admin/rest/.env
    echo "  * API fijada al puerto {{API_PORT}} en los tres .env"

# Instala dependencias de Node (dos instalaciones separadas, ~15 min)
[group('setup')]
install: install-apps install-api

# Workspace del frontend: shop + admin/rest + admin/graphql (~11 min)
[group('setup')]
[working-directory: 'apps']
install-apps:
    yarn install --network-timeout 600000

# API NestJS: fuera del workspace, necesita su propio install (~4 min)
[group('setup')]
[working-directory: 'apps/api/rest']
install-api:
    yarn install --network-timeout 600000


# ──────────────────────── desarrollo ─────────────────────────

# API mock NestJS. Arrancala primero: los frontends la consultan en SSR
[group('dev')]
[working-directory: 'apps/api/rest']
api-dev:
    PORT={{API_PORT}} yarn start:dev

# Tienda Next.js (REST)
[group('dev')]
[working-directory: 'apps/shop']
shop-dev:
    yarn dev:rest

# Panel de administracion Next.js (REST)
[group('dev')]
[working-directory: 'apps/admin/rest']
admin-dev:
    yarn dev


# ────────────────────── build y produccion ───────────────────

# Build de produccion de shop + admin. Detén antes los `dev`: comparten .next
[group('build')]
build: build-shop build-admin

# Solo la tienda
[group('build')]
[working-directory: 'apps/shop']
build-shop:
    yarn build:rest

# Solo el admin
[group('build')]
[working-directory: 'apps/admin/rest']
build-admin:
    yarn build

# Compila la API a dist/ (para desplegar sin ts-node)
[group('build')]
[working-directory: 'apps/api/rest']
build-api:
    yarn build

# Sirve el build de la tienda (next start -> puerto 3000)
[group('build')]
[working-directory: 'apps/shop']
start-shop:
    yarn start

# Sirve el build del admin (next start -> puerto 3002)
[group('build')]
[working-directory: 'apps/admin/rest']
start-admin:
    yarn start


# ───────────────────────── verificacion ──────────────────────

# Comprueba que API, shop y admin responden con contenido real
[group('verify')]
verify:
    #!/usr/bin/env node
    const http = require('http');
    const targets = [
      { name: 'API   ', port: {{API_PORT}},   path: '/api/settings' },
      { name: 'Shop  ', port: {{SHOP_PORT}},  path: '/en' },
      { name: 'Admin ', port: {{ADMIN_PORT}}, path: '/en/login' },
    ];
    let fallos = 0;
    (async () => {
      for (const t of targets) {
        await new Promise((done) => {
          const t0 = Date.now();
          const req = http.get({ host: '127.0.0.1', port: t.port, path: t.path }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              const cards = [...body.matchAll(/product-card[^>]*>/g)].length;
              const ok = res.statusCode === 200;
              if (!ok) fallos++;
              console.log(
                `${ok ? 'OK  ' : 'FALLA'} ${t.name} :${t.port}${t.path}  ` +
                `${res.statusCode}  ${body.length}B  ${Date.now() - t0}ms` +
                (cards ? `  cards:${cards}` : '')
              );
              done();
            });
          });
          // Next.js compila la ruta en el primer request: puede tardar ~90s
          req.setTimeout(180000, () => { console.log(`FALLA ${t.name} :${t.port} timeout`); fallos++; req.destroy(); done(); });
          req.on('error', (e) => { console.log(`FALLA ${t.name} :${t.port} ${e.code || e.message}`); fallos++; done(); });
        });
      }
      process.exit(fallos ? 1 : 0);
    })();

# Revisa si los puertos estan libres y quien los ocupa (ver Zscaler en el README)
[group('verify')]
check-ports:
    #!/usr/bin/env node
    const net = require('net');
    const { execSync } = require('child_process');
    const ports = [{{API_PORT}}, {{SHOP_PORT}}, {{ADMIN_PORT}}];
    const quien = (port) => {
      try {
        if (process.platform !== 'win32') return '';
        const out = execSync(`netstat -ano | findstr ":${port} " | findstr LISTENING`, { encoding: 'utf8' });
        const pid = out.trim().split(/\r?\n/)[0].trim().split(/\s+/).pop();
        const tl = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { encoding: 'utf8' });
        return `  <- PID ${pid} (${tl.split(',')[0].replace(/"/g, '')})`;
      } catch { return ''; }
    };
    // Se prueba CONECTANDO, no bindeando: en Windows SO_REUSEADDR deja
    // re-bindear un puerto que ya tiene un servidor Node y da falsos "libre".
    (async () => {
      for (const port of ports) {
        const ocupado = await new Promise((r) => {
          const s = net.connect({ host: '127.0.0.1', port });
          const cerrar = (v) => { s.destroy(); r(v); };
          s.setTimeout(2000);
          s.once('connect', () => cerrar(true));
          s.once('timeout', () => cerrar(true));
          s.once('error', () => cerrar(false));
        });
        console.log(`${ocupado ? 'OCUPADO ' : 'libre   '} ${port}${ocupado ? quien(port) : ''}`);
      }
    })();

# Revisa que el entorno tenga todo lo necesario
[group('verify')]
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    echo "node    $(node -v 2>/dev/null || echo 'FALTA - instala Node 20+')"
    echo "yarn    $(yarn -v 2>/dev/null || echo 'FALTA - npm i -g yarn')"
    echo "python  $(python --version 2>&1 || echo 'FALTA - solo necesario para el scraper')"
    for f in apps/api/rest/.env apps/shop/.env apps/admin/rest/.env; do
      [ -f "$f" ] && echo "env     $f OK" || echo "env     $f FALTA - corre 'just env'"
    done
    for d in apps/node_modules apps/api/rest/node_modules; do
      [ -d "$d" ] && echo "deps    $d OK" || echo "deps    $d FALTA - corre 'just install'"
    done


# ─────────────────────────── scraper ─────────────────────────
#
# OJO: el proyecto Scrapy esta roto en el repo. settings.py, scrapy.cfg y los
# seis spiders importan el paquete `alkosto_project`, que no existe: los
# archivos se aplanaron en services/scraper-worker/ sin actualizar las
# referencias. `just scrape` fallara con ModuleNotFoundError hasta que se
# recree el paquete o se reescriban esos imports.

# Instala las dependencias Python del scraper + navegadores de Playwright
[group('scraper')]
[working-directory: 'services/scraper-worker']
scraper-install:
    python -m pip install -r requirements.txt
    python -m playwright install chromium

# Ejecuta un spider (alkosto|compulago|compuworking|exito|falabella|tauret)
[group('scraper')]
[working-directory: 'services/scraper-worker']
scrape spider:
    scrapy crawl {{spider}}


# ─────────────────────────── limpieza ────────────────────────

# Borra artefactos de build (.next, dist). No toca node_modules ni .env
[group('limpieza')]
clean:
    rm -rf apps/shop/.next apps/admin/rest/.next apps/admin/graphql/.next apps/api/rest/dist

# Borra ademas node_modules: obliga a reinstalar (~15 min). No toca los .env
[group('limpieza')]
clean-all: clean
    rm -rf apps/node_modules apps/api/rest/node_modules apps/api/graphql/node_modules
