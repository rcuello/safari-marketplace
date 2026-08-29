import os
import re
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
RETURNING (xmax = 0) AS fue_insercion
"""

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

        # El get-or-create de shops/manufacturers va DENTRO del try: tambien
        # habla con Postgres, y un fallo suyo debe contarse en `fallidos`
        # como cualquier otro, no escaparse de process_item y romper la
        # invariante insertados + actualizados + fallidos == procesados.
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
                fue_insercion = cur.fetchone()[0]
            self.stats["insertados" if fue_insercion else "actualizados"] += 1
        except psycopg.Error as e:
            constraint = getattr(e.diag, "constraint_name", None)
            detalle = MENSAJES_CONSTRAINT.get(constraint, str(e))
            spider.logger.error(f"Error guardando '{nombre}': {detalle}")
            self.stats["fallidos"] += 1

        return item
