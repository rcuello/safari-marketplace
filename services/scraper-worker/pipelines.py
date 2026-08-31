import os
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import psycopg
from itemadapter import ItemAdapter
from psycopg.types.json import Jsonb


# Los spiders producen precios ya formateados como texto: "1.299.900 COP",
# "$ 2.499.000", "44%". Postgres los quiere como numeros, asi que la
# conversion tiene que pasar SI O SI por aqui. Es justo lo que la version en
# Mongo se podia saltar, y por eso alli nadie noto que el precio era una
# cadena hasta que hizo falta ordenar por precio.
#
# Formato colombiano: el punto separa miles y la coma separa decimales.
#   "1.299.900 COP" -> 1299900
#   "$ 89.900,50"   -> 89900.50
#   "44%"           -> 44
def parse_numero(valor):
    if valor is None:
        return None
    limpio = re.sub(r"[^\d,]", "", str(valor))
    if not limpio:
        return None
    try:
        return Decimal(limpio.replace(",", "."))
    except InvalidOperation:
        return None


# `ratings` es numeric(3,2) (maximo 9.99): no puede reusar parse_numero, que
# concatena todos los digitos de la cadena. Exito emite un float (4.5) que
# parse_numero convertiria en 45 -> overflow. Aqui se parte de la
# representacion en string del valor crudo, se redondea a 2 decimales y se
# descarta cualquier cosa fuera de [0, 9.99] (la cota va DESPUES de
# redondear: 9.995 sin redondear pasaria un `< 10` y Postgres la guardaria
# como 10.00, el mismo overflow que este helper evita).
def parse_calificacion(valor):
    if valor is None:
        return None
    try:
        numero = Decimal(str(valor)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None
    if not numero.is_finite():
        # Decimal("NaN").quantize() NO lanza, pero comparar NaN si: sin esta
        # guarda un 'nan' en calificacion tumbaria la corrida entera.
        return None
    if numero < 0 or numero > Decimal("9.99"):
        return None
    return numero


# La app espera {id, original, thumbnail} en `image` (jsonb). El scraper no
# genera miniaturas: la misma URL va en los dos slots y `id` queda en null
# porque no hay un attachment real detras.
def imagen_jsonb(url):
    if not url:
        return None
    return Jsonb({"id": None, "original": url, "thumbnail": url})


def normalizar_texto(valor):
    # `str(valor or "")` evita un TypeError si `categoria` llega como None o
    # como un tipo no-str (revienta FUERA del try y tumba la corrida entera).
    # NFKD + descartar los combining marks quita tildes sin dependencias
    # nuevas (unicodedata es stdlib); `.strip()` evita que " otros " caiga al
    # fallback solo por espacios sobrantes.
    sin_tildes = unicodedata.normalize("NFKD", str(valor or ""))
    sin_tildes = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return sin_tildes.lower().strip()


def normalizar_enlace(url):
    partes = urlparse(url or "")
    limpio = f"{partes.scheme}://{partes.netloc}{partes.path}"
    if partes.query:
        limpio += f"?{partes.query}"
    return limpio


def extraer_product_id(url, fallback):
    # La mayoria de las tiendas exponen un ID numerico en la URL. Si no lo
    # hay, el enlace normalizado sirve de clave natural.
    match = re.search(r"/product/(\d+)/", url or "")
    return match.group(1) if match else fallback


# `type_id` fijo del catalogo compartido: los 6 spiders recolectan productos
# tecnologicos, que es exactamente lo que cubre el type 'gadget' sembrado en
# db/seed.sql. Se busca por slug, no por el id crudo del seed.
SQL_TYPE_ID = "SELECT id FROM types WHERE slug = 'gadget'"

# Mapa cerrado etiqueta cruda -> slug del catalogo (Decision A). `audio` NO es
# entrada de este dict: se resuelve aparte por palabras clave (Decision B).
# Las 4 que caen al resto (tablets, impresoras, perifericos, otros) se
# declaran explicitas porque db/README.md no les da renglon propio.
RAW_A_SLUG = {
    "computadores": "laptop",
    "celulares": "mobiles",
    "pantallas": "monitor",
    "consolas": "console",
    "tablets": "accessories-gfa",
    "impresoras": "accessories-gfa",
    "perifericos": "accessories-gfa",
    "otros": "accessories-gfa",
}

SLUG_RESTO = "accessories-gfa"

# Los 7 slugs destino que el pipeline efectivamente escribe (Decision D):
# list, no set/tuple -- psycopg 3 adapta una list a array de Postgres, que es
# lo que exige `= ANY(%s)`; un set no se adapta y una tuple iria como record.
SLUGS_CATEGORIA = [
    "laptop",
    "mobiles",
    "monitor",
    "console",
    "headphone",
    "sound-box",
    "accessories-gfa",
]

# Subconjunto elegido (no la union) del vocabulario de audifono de los 6
# spiders, en raices singulares sin acento -- la raiz cubre plural y tilde
# por subcadena una vez que `nombre` pasa por normalizar_texto(). Exclusiones
# deliberadas (Decision B): marcas que fabrican tanto audifono como parlante
# ("beats " generico, "marshall ", "soundcore", "sony xb", "jbl grip") se
# dejan fuera a proposito -- incluirlas mandaria parlantes a `headphone`, un
# falso positivo peor que el residual hacia `sound-box`.
KEYWORDS_AUDIFONO = [
    "audifono",
    "auricular",
    "diadema",
    "headset",
    "headphone",
    "earphone",
    "earbud",
    "buds",
    "airpods",
    "air pods",
    "jabra",
    "soundpeats",
    "powerbeats",
    "beats studio",
    "beats fit",
    "beats flex",
    "sony wh",
    "sony wf",
    "jbl tune",
    "jbl live",
    "jbl free",
    "jbl reflect",
    "jbl endurance",
    "jbl vibe",
    "jbl wave",
    "wave beam 2",
    "bose quietcomfort",
    "bose sport",
    "earfun",
    "soundgear frames",
]


def slug_de_etiqueta(categoria, nombre):
    """Traduce la etiqueta cruda del spider a un slug del catalogo. `audio`
    se desambigua por palabras clave del nombre (Decision B); el resto sale
    de RAW_A_SLUG. `None` si la etiqueta no mapea -- el caller hace el
    fallback a SLUG_RESTO y lo loguea."""
    categoria_normalizada = normalizar_texto(categoria)
    if categoria_normalizada == "audio":
        nombre_normalizado = normalizar_texto(nombre)
        for termino in KEYWORDS_AUDIFONO:
            if termino in nombre_normalizado:
                return "headphone"
        return "sound-box"
    return RAW_A_SLUG.get(categoria_normalizada)


# Tuplas (select, insert) para el get-or-create de _resolver_referencia.
# El slug lo calcula la base (slugify), no Python: la clave del cache en
# tiempo de ejecucion es el nombre crudo, no el slug.
SQL_SHOP = (
    "SELECT id FROM shops WHERE slug = slugify(%s)",
    "INSERT INTO shops (name, slug) VALUES (%s, slugify(%s)) "
    "ON CONFLICT (slug) DO NOTHING RETURNING id",
)

SQL_MANUFACTURER = (
    "SELECT id FROM manufacturers WHERE slug = slugify(%s)",
    "INSERT INTO manufacturers (name, slug) VALUES (%s, slugify(%s)) "
    "ON CONFLICT (slug) DO NOTHING RETURNING id",
)


UPSERT_PRODUCT = """
INSERT INTO products (
    name, slug, type_id, shop_id, manufacturer_id, product_type,
    price, sale_price, min_price, max_price, image, ratings,
    source_store, source_product_id, source_url, scraped_at
) VALUES (
    %(nombre)s,
    slugify(%(nombre)s || ' ' || %(tienda)s),
    %(type_id)s, %(shop_id)s, %(manufacturer_id)s, 'simple',
    %(price)s, %(sale_price)s, %(price)s, %(price)s,
    %(image)s, COALESCE(%(ratings)s, 0),
    %(tienda)s, %(product_id)s, %(enlace)s, now()
)
ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL
DO UPDATE SET
    name            = EXCLUDED.name,
    shop_id         = EXCLUDED.shop_id,
    manufacturer_id = EXCLUDED.manufacturer_id,
    price           = EXCLUDED.price,
    sale_price      = EXCLUDED.sale_price,
    min_price       = EXCLUDED.min_price,
    max_price       = EXCLUDED.max_price,
    image           = COALESCE(EXCLUDED.image, products.image),
    source_url      = EXCLUDED.source_url,
    scraped_at      = EXCLUDED.scraped_at
RETURNING id, (xmax = 0) AS fue_insercion
"""

# category_id de los 7 slugs destino (Decision D): una unica query, read-only,
# resuelta en open_spider una vez por corrida. NO crea categorias -- si falta
# un slug, open_spider aborta antes del primer item nombrando los faltantes.
# Se filtra tambien por type_id (aunque categories.slug es UNIQUE global) para
# documentar el contrato y evitar colar un homonimo de otra vertical.
SQL_CATEGORIA_IDS = "SELECT slug, id FROM categories WHERE type_id = %s AND slug = ANY(%s)"

# Saneo (D-9): quita la categoria anterior del producto si cambio de etiqueta
# entre corridas. Va ANTES del insert y dentro de la MISMA frontera del try
# que el upsert de products -- si el producto se re-etiqueta, DO NOTHING no
# borraria la fila vieja y el producto quedaria en dos categorias a la vez.
DELETE_CATEGORY_PRODUCT = (
    "DELETE FROM category_product "
    "WHERE product_id = %(producto_id)s AND category_id <> %(category_id)s"
)

# Fila puente, idempotente (CA-2). A diferencia del ON CONFLICT de products,
# este NO lleva WHERE: la PK compuesta (product_id, category_id) es un indice
# unico total, no parcial -- anadirle un WHERE seria un error.
INSERT_CATEGORY_PRODUCT = (
    "INSERT INTO category_product (product_id, category_id) "
    "VALUES (%(producto_id)s, %(category_id)s) "
    "ON CONFLICT (product_id, category_id) DO NOTHING"
)

# Mensajes para las violaciones de constraint que la validacion previa en
# Python no deberia dejar pasar nunca: si aparecen, es un bug del pipeline,
# no un dato malo del spider. `products_slug_key` es la excepcion: es un
# residual declarado de la Decision D (dos homonimos en la MISMA tienda).
MENSAJES_CONSTRAINT = {
    "products_rebaja_valida": "promocion >= precio pese al saneo previo",
    "products_simple_con_precio": "producto 'simple' sin precio",
    "products_procedencia_completa": "procedencia incompleta",
    "products_slug_key": "slug duplicado: ya existe otro producto con ese nombre en esta tienda",
}


class PostgresPipeline:
    """Guarda cada item en el catalogo compartido de Postgres (products,
    shops, manufacturers) -- la MISMA base que consulta la tienda, no una
    tabla propia del scraper.

    El upsert es por procedencia -- (source_store, source_product_id)-- via
    el indice parcial `products_procedencia_key`: reprocesar el mismo item
    actualiza la fila existente en vez de duplicarla. `shops` y
    `manufacturers` se resuelven con un get-or-create cacheado por corrida
    (una conexion, un proceso por spider); `type_id` se resuelve una unica
    vez en `open_spider` y aborta la corrida si el catalogo base ('gadget')
    no esta sembrado, en vez de degradar a descarte item por item.

    Tambien materializa la fila puente en `category_product`: la etiqueta
    cruda de cada item se traduce a un slug ya existente del catalogo
    (`slug_de_etiqueta`) y el `category_id` correspondiente se resuelve por
    `SELECT` read-only en `open_spider` (`self.categorias`) -- este pipeline
    NUNCA crea categorias.
    """

    def open_spider(self, spider):
        dsn = spider.settings.get("DATABASE_URL")
        if not dsn:
            # Fallar aqui y con un mensaje claro es mejor que conectarse por
            # accidente a una base equivocada a mitad de una corrida larga.
            raise ValueError(
                "DATABASE_URL no esta definida. Copia .env.example a .env "
                "o exporta la variable. Ej: "
                "postgresql://safari:safari@localhost:5432/safari_scraper"
            )
        self.conn = psycopg.connect(dsn, autocommit=True)

        with self.conn.cursor() as cur:
            cur.execute(SQL_TYPE_ID)
            fila_type = cur.fetchone()
        if fila_type is None:
            self.conn.close()
            raise ValueError(
                "No existe el type 'gadget' en la base: el catalogo no esta sembrado.\n"
                "Corre `just db-up` (o `just db-reset` si la base quedo a medias)."
            )
        self.type_id = fila_type[0]

        with self.conn.cursor() as cur:
            cur.execute(SQL_CATEGORIA_IDS, (self.type_id, SLUGS_CATEGORIA))
            self.categorias = dict(cur.fetchall())
        faltantes = set(SLUGS_CATEGORIA) - set(self.categorias)
        if faltantes:
            self.conn.close()
            raise ValueError(
                "Faltan slugs de categoria en la base: "
                f"{sorted(faltantes)}. El catalogo no esta sembrado "
                "completo.\nCorre `just db-up` (o `just db-reset` si la "
                "base quedo a medias)."
            )

        self.shops = {}
        self.manufacturers = {}
        self.stats = {
            "insertados": 0,
            "actualizados": 0,
            "fallidos": 0,
            "promociones_descartadas": 0,
        }
        spider.logger.info(f"Conectado a Postgres; spider: {spider.name}")

    def close_spider(self, spider):
        self.conn.close()
        spider.logger.info(f"Postgres resumen: {self.stats}")

    def _resolver_referencia(self, sql, cache, nombre):
        """Get-or-create cacheado por corrida. `nombre` es el valor crudo del
        item (nombre de tienda o marca); el slug lo calcula la base. `None`
        si el nombre viene vacio (p. ej. un item sin marca)."""
        nombre = (nombre or "").strip()
        if not nombre:
            return None
        if nombre in cache:
            return cache[nombre]

        select_sql, insert_sql = sql
        with self.conn.cursor() as cur:
            cur.execute(select_sql, (nombre,))
            fila = cur.fetchone()
            if fila is None:
                cur.execute(insert_sql, (nombre, nombre))
                fila = cur.fetchone()
                if fila is None:
                    # Otra corrida la creo entre medias: la sentencia anterior
                    # no devolvio fila por el DO NOTHING. Va un SELECT de
                    # respaldo en vez de asumir que ya existe.
                    cur.execute(select_sql, (nombre,))
                    fila = cur.fetchone()

        if fila is None:
            # Ni el SELECT, ni el INSERT, ni el SELECT de respaldo dieron id.
            # Se levanta un error legible en vez de dejar que reviente como
            # `NoneType is not subscriptable` mas abajo.
            raise RuntimeError(
                f"no se pudo resolver la referencia para {nombre!r}"
            )

        cache[nombre] = fila[0]
        return cache[nombre]

    def process_item(self, item, spider):
        datos = ItemAdapter(item).asdict()
        nombre = datos.get("nombre")
        tienda = datos.get("tienda") or spider.name
        enlace = datos.get("enlace")

        if not nombre:
            spider.logger.warning(
                f"Item sin nombre descartado (tienda={tienda})"
            )
            self.stats["fallidos"] += 1
            return item

        if not enlace:
            # Un enlace vacio degeneraria en un source_product_id
            # degenerado ("://") que colisiona con el de otro item sin
            # enlace de la misma tienda: la guarda real es esta, no el
            # CHECK de procedencia completa.
            spider.logger.warning(
                f"Item '{nombre}' sin enlace descartado (tienda={tienda})"
            )
            self.stats["fallidos"] += 1
            return item

        price = parse_numero(datos.get("precio"))
        if price is None or price <= 0:
            # El caso mayoritario es 0 ("0 COP" en 3 de 6 spiders), no None:
            # el CHECK de products no atrapa un precio en cero.
            spider.logger.warning(
                f"Item '{nombre}' sin precio valido descartado "
                f"(precio={datos.get('precio')!r}, tienda={tienda})"
            )
            self.stats["fallidos"] += 1
            return item

        sale_price = parse_numero(datos.get("promocion"))
        if sale_price is not None and sale_price >= price:
            # Se descarta la promocion, no el producto: nombre, precio de
            # lista y procedencia siguen siendo datos buenos.
            spider.logger.warning(
                f"Item '{nombre}': promocion ({sale_price}) >= precio "
                f"({price}), se descarta la promocion"
            )
            sale_price = None
            self.stats["promociones_descartadas"] += 1

        enlace_normalized = normalizar_enlace(enlace)

        # Resolucion del slug (Python puro, no puede lanzar psycopg.Error):
        # va FUERA del try, junto a los demas saneos. `None` significa que la
        # etiqueta cruda no mapea -- cae al resto y queda logueado, como
        # exige CA-1.
        slug = slug_de_etiqueta(datos.get("categoria"), nombre)
        if slug is None:
            spider.logger.warning(
                f"Item '{nombre}': categoria {datos.get('categoria')!r} no "
                f"mapea a un slug conocido, se usa el resto ({SLUG_RESTO})"
            )
            slug = SLUG_RESTO

        # El get-or-create de shops/manufacturers va DENTRO del try: tambien
        # habla con Postgres, y un error de Postgres suyo debe contarse en
        # `fallidos` como cualquier otro, no escaparse de process_item.
        #
        # OJO, la invariante insertados + actualizados + fallidos ==
        # procesados se cumple para los errores de Postgres, NO para todas
        # las rutas: _resolver_referencia levanta RuntimeError (estado
        # imposible: ni el SELECT, ni el INSERT, ni el SELECT de respaldo
        # dieron id), que no es psycopg.Error y escapa de aqui abortando la
        # corrida sin sumar a ningun contador. Es inalcanzable en la
        # practica y falla ruidoso, no silencioso; queda declarado en vez de
        # ampliar el except (ver W-3 del verify de US-6).
        try:
            fila = {
                "nombre": nombre,
                "tienda": tienda,
                "type_id": self.type_id,
                "shop_id": self._resolver_referencia(
                    SQL_SHOP, self.shops, tienda
                ),
                "manufacturer_id": self._resolver_referencia(
                    SQL_MANUFACTURER, self.manufacturers, datos.get("marca")
                ),
                "price": price,
                "sale_price": sale_price,
                "image": imagen_jsonb(datos.get("imagen")),
                "ratings": parse_calificacion(datos.get("calificacion")),
                "product_id": extraer_product_id(enlace, enlace_normalized),
                "enlace": enlace,
            }

            with self.conn.cursor() as cur:
                cur.execute(UPSERT_PRODUCT, fila)
                producto_id, fue_insercion = cur.fetchone()

                # Puente hacia category_product: DENTRO del mismo try/cursor,
                # justo tras el upsert (Decision F). El DELETE de saneo va
                # ANTES del INSERT para que un cambio de etiqueta entre
                # corridas no deje al producto en dos categorias (D-9). Si
                # cualquiera de las dos falla, la excepcion salta al except
                # de abajo SIN pasar por el incremento de stats siguiente:
                # el item cuenta solo en `fallidos`, preservando la
                # invariante insertados + actualizados + fallidos == procesados
                # (D-7 -- `products` ya quedo persistido por autocommit).
                puente = {"producto_id": producto_id, "category_id": self.categorias[slug]}
                cur.execute(DELETE_CATEGORY_PRODUCT, puente)
                cur.execute(INSERT_CATEGORY_PRODUCT, puente)
            self.stats["insertados" if fue_insercion else "actualizados"] += 1
        except psycopg.Error as e:
            constraint = getattr(e.diag, "constraint_name", None)
            detalle = MENSAJES_CONSTRAINT.get(constraint, str(e))
            spider.logger.error(f"Error guardando '{nombre}': {detalle}")
            self.stats["fallidos"] += 1

        return item
