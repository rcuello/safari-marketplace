# 🛒 Multi-Store Tech Scraper - Colombia Edition

![Python](https://img.shields.io/badge/Python-3.x-blue?logo=python&logoColor=white)
![Scrapy](https://img.shields.io/badge/Scrapy-2.8+-green?logo=scrapy)
![Playwright](https://img.shields.io/badge/Playwright-Automated-orange?logo=playwright)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql&logoColor=white)

Un ecosistema avanzado de web scraping diseñado para la extracción masiva y automatizada de productos tecnológicos de las principales tiendas en Colombia. Este proyecto es una solución robusta para el monitoreo de precios y análisis de mercado en tiempo real.

## 📋 Tabla de Contenidos

- [Descripción](#-descripción)
- [Tiendas Soportadas](#-tiendas-soportadas)
- [Características Técnicas](#-características-técnicas)
- [Instalación y Configuración](#-instalación-y-configuración)
- [Uso y Ejecución](#-uso-y-ejecución)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Sobre la base de datos](#️-sobre-la-base-de-datos)
- [Equipo de Desarrollo](#-equipo-de-desarrollo)

---

## 📝 Descripción

Este proyecto implementa un sistema multi-tienda capaz de navegar sitios web modernos con renderizado dinámico. Gracias a la integración de **Scrapy** y **Playwright**, los spiders pueden interactuar con interfaces complejas (React, Next.js, etc.) para extraer datos precisos de:
- 💻 Computadores y Portátiles
- 📱 Celulares y Tablets
- 🎮 Componentes Gaming y Periféricos

### Casos de Uso:
- 📊 **Análisis competitivo**: Comparativa entre las 6 tiendas tecnológicas más grandes del país.
- 📈 **Histórico de precios**: Rastreo de variaciones y detección de ofertas reales.
- 💹 **Business Intelligence**: Recolección de datos para toma de decisiones comerciales.

---

## 🏢 Tiendas Soportadas

El sistema cuenta con 6 spiders especializados y optimizados:

| Tienda | Spider Name | Enfoque |
| :--- | :--- | :--- |
| **Alkosto** | `alkosto` | Líder en consumo masivo tech |
| **Éxito** | `exito` | Gran retail nacional |
| **Falabella** | `falabella` | Multinacional de retail |
| **Tauret Computadores** | `tauret` | Especialistas en Gaming/High-end |
| **CompuLago** | `compulago` | Hardware y periféricos |
| **CompuWorking** | `compuworking` | Soluciones corporativas y hardware |

> Los nombres de esta columna son los que reconoce Scrapy. Compruébalos en
> cualquier momento con `just spiders`.

---

## ⭐ Características Técnicas

- **Renderizado Dinámico**: Manejo de JavaScript mediante `scrapy-playwright`.
- **Evasión de Bloqueos**: Rotación de cabeceras y gestión de tiempos de espera inteligentes.
- **Pipelines de Limpieza**: Los precios llegan del spider como texto (`"1.299.900 COP"`,
  `"44%"`) y el pipeline los convierte a `NUMERIC` antes de guardarlos. Sin esa
  conversión la base rechaza la fila: es el contrato que un esquema relacional
  impone y que un documento no.
- **Persistencia relacional**: Los productos se guardan en **PostgreSQL**, una fila
  por par `(tienda, product_id)`. Ver [`schema.sql`](schema.sql) para el modelo
  y las notas de diseño.

---

## 🔧 Instalación y Configuración

Todo se maneja con `just` desde la raíz del repo:

```bash
just scraper-install   # crea el venv e instala dependencias + Chromium
just db-up             # levanta Postgres en Docker, aplica el esquema y crea el .env
just spiders           # comprueba que Scrapy reconoce los 6 spiders
just db-test           # prueba el pipeline contra la base, sin salir a internet
```

### A mano, sin `just`

```bash
cd services/scraper-worker
python -m venv .venv
# Activar en Windows:  .venv\Scripts\activate
# Activar en Unix:     source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

cp .env.example .env
docker compose up -d postgres      # desde la raíz del repo
```

### Variables de Entorno

Una sola: la cadena de conexión. Nunca se versiona.

```env
DATABASE_URL=postgresql://safari:safari@localhost:5433/safari_scraper
```

> El puerto es **5433**, no el 5432 por defecto, para no chocar con una
> instalación de Postgres que ya exista en la máquina.

---

## 🚀 Uso y Ejecución

```bash
just scrape alkosto      # o compulago, compuworking, exito, falabella, tauret
just db-count            # cuántos productos hay, por tienda y categoría
just db-shell            # sesión psql interactiva
```

Directamente con Scrapy:

```bash
cd services/scraper-worker
.venv/Scripts/python -m scrapy crawl falabella
.venv/Scripts/python -m scrapy crawl falabella -o datos.json   # además, a fichero
```

---

## 📂 Estructura del Proyecto

```text
services/scraper-worker/
├── spiders/                 # Los 6 Spiders (Alkosto, Éxito, Falabella, etc.)
├── items.py                 # Modelo de datos por tienda
├── pipelines.py             # Conversión de precios y upsert en Postgres
├── settings.py              # Configuración de Playwright, Scrapy y DATABASE_URL
├── schema.sql               # Esquema de la base, con notas de modelado
├── test_pipeline.py         # Prueba del pipeline sin red
└── scrapy.cfg
```

---

## 🗄️ Sobre la base de datos

El proyecto usaba **MongoDB Atlas** con una base por tienda y una colección por
categoría. Eso metía "de qué tienda es" y "de qué categoría es" dentro de la
*estructura* en vez de en los *datos*, así que una pregunta tan simple como
«los 10 portátiles más baratos del país» obligaba a recorrer seis bases y unir
los resultados a mano.

Con Postgres, `tienda` y `categoria` son dos columnas de una misma tabla:

```sql
SELECT nombre, tienda, precio
FROM productos
WHERE categoria = 'portatiles'
ORDER BY precio
LIMIT 10;
```

Dos consecuencias que se ven directamente en el código:

- El diccionario en memoria que cargaba la base entera al arrancar cada spider
  desapareció: ese trabajo lo hace el índice `UNIQUE (tienda, product_id)`.
- El `if/elif/else` de tres ramas (insertar / mover de colección / actualizar)
  se volvió un único `INSERT ... ON CONFLICT DO UPDATE`.

### Ejercicios sugeridos

- **Histórico de precios.** Hoy cada corrida pisa el precio anterior. Una tabla
  `precio_historico (producto_id, precio, capturado_en)` permitiría responder
  «¿este descuento es real, o el precio subió justo antes del Black Friday?».
- **Normalizar marcas y categorías** a sus propias tablas, con claves foráneas.
- **Búsqueda de texto** con un índice `tsvector` sobre `nombre`.

---

## 👥 Equipo de Desarrollo

Este proyecto fue desarrollado con dedicación por:

*   **Lucho Jimenez**
*   **Diego Serpa**
*   **Cesar Jimenez**
*   **Bibi Ledesma**

### 🎓 Mención Especial
Un agradecimiento total a nuestro profesor **Chavarriga, Claude, Geminni, GithubCopilot**, quien nos guio en el proceso y nos dio las bases para montar este proyecto bien cartelúo.

---
<div align="center">
  <b>© 2026 - Proyecto de Web Scraping</b>
</div>
