# db/ — el catálogo compartido

Una sola base para dos consumidores: el **scraper escribe** productos y la
**tienda Next.js los consulta**, desde las mismas tablas.

| Archivo | Qué es |
|---|---|
| [`schema.sql`](schema.sql) | El DDL, con las decisiones de modelado comentadas |
| [`seed.sql`](seed.sql) | **Generado.** Los datos reales de la aplicación |
| [`generate-seed.mjs`](generate-seed.mjs) | Produce `seed.sql` desde los JSON del mock |

```bash
just db-up              # levanta Postgres, aplica esquema y seed
just db-seed-generate   # regenera seed.sql desde los JSON
just db-shell           # sesión psql
```

## De dónde salen los datos

`seed.sql` no se escribe a mano: sale de `apps/api/rest/src/db/pickbazar/*.json`,
que es el mock que la API sirve hoy. El generador valida antes de emitir, así
que si el mock violara alguna restricción del esquema falla en vez de producir
SQL inaplicable.

```
10 types · 12 shops · 198 categorías · 14 manufacturers · 10 tags · 1200 productos
```

**Los ids del mock se preservan** para no romper las relaciones, y al final se
adelantan las secuencias. Dos cosas que el generador resuelve y conviene saber:

- **Tres shops se reconstruyen.** 190 productos referencian `shop_id` 12, 14 y
  15, que no existen en `shops.json`. Con claves foráneas reales esas filas
  serían imposibles. La identidad sí está disponible porque cada producto
  embebe su objeto `shop`, así que se recuperan de ahí en lugar de descartar
  190 productos o inventar tiendas de relleno.
- **`category_product` queda vacía a propósito.** Ninguno de los 1200 productos
  del mock trae categorías, aunque la entidad las declara y el buscador filtra
  por `categories.slug`. En la app original, hoy, buscar por categoría devuelve
  cero resultados. No se inventan enlaces.

## Cómo se adapta el scraper

**El seed contiene solo datos de la aplicación.** El scraper no aporta filas
aquí: es él quien debe encajar en esta taxonomía.

El type `gadget` ya trae diez categorías que cubren lo que los spiders
recolectan. El método `categorizar()` de cada spider debe devolver **estos
slugs**, no inventar los suyos:

| Lo que produce el spider | Categoría que ya existe |
|---|---|
| portátiles | `laptop` |
| celulares | `mobiles` |
| monitores | `monitor` |
| gaming / consolas | `console` |
| audio / parlantes | `headphone`, `sound-box` |
| cámaras | `camera` |
| redes | `router` |
| relojes | `smart-watch` |
| periféricos y demás | `accessories-gfa` |

Lo que el scraper **sí** crea en tiempo de ejecución, porque es genuinamente
suyo y no existe en la app:

- **Los retailers como `shops`** (Alkosto, Éxito, Falabella, CompuLago,
  CompuWorking, Tauret). Ninguno es un shop de Pickbazar.
- **Las marcas como `manufacturers`**. Las 14 del mock son casi todas
  editoriales de libros; no hay ni una marca de tecnología real.
- **Las filas de `category_product`**, que la app dejó vacías.

## Decisión pendiente: la moneda

`settings.options.currency` es **`USD` con 2 decimales**, tal como lo trae la
app. Los precios que scrapea el worker son **pesos colombianos sin decimales**.

Pickbazar asume una única moneda para todo el marketplace, así que hay tres
salidas y ninguna es gratis:

1. **Cambiar el setting a `COP` / `es-CO` / 0 decimales.** Lo más simple, pero
   los 1200 productos del mock (con precios de 2 a 421 USD) quedarían
   mostrándose como si fueran pesos.
2. **Convertir los precios scrapeados a USD** al guardarlos. Coherente con el
   mock, pero introduce una tasa de cambio que hay que mantener.
3. **Moneda por producto.** Lo correcto de verdad, pero se desvía del modelo de
   Pickbazar y obliga a tocar el formateo en el frontend.

Es una decisión de producto, no técnica.
