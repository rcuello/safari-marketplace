import os
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import psycopg
from itemadapter import ItemAdapter


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


UPSERT = """
INSERT INTO productos (
    tienda, product_id, nombre, marca, categoria,
    precio, promocion, descuento, calificacion, vendedor,
    imagen, enlace, enlace_normalized
) VALUES (
    %(tienda)s, %(product_id)s, %(nombre)s, %(marca)s, %(categoria)s,
    %(precio)s, %(promocion)s, %(descuento)s, %(calificacion)s, %(vendedor)s,
    %(imagen)s, %(enlace)s, %(enlace_normalized)s
)
ON CONFLICT (tienda, product_id) DO UPDATE SET
    nombre            = EXCLUDED.nombre,
    marca             = EXCLUDED.marca,
    categoria         = EXCLUDED.categoria,
    precio            = EXCLUDED.precio,
    promocion         = EXCLUDED.promocion,
    descuento         = EXCLUDED.descuento,
    calificacion      = EXCLUDED.calificacion,
    vendedor          = EXCLUDED.vendedor,
    imagen            = EXCLUDED.imagen,
    enlace            = EXCLUDED.enlace,
    enlace_normalized = EXCLUDED.enlace_normalized,
    visto_ultima_vez  = now()
RETURNING (xmax = 0) AS fue_insercion
"""


class PostgresPipeline:
    """Guarda cada item en la tabla productos.

    Comparado con la version en MongoDB, aqui desaparecen dos cosas:

    1. El diccionario `self._cache`, que al arrancar leia la base ENTERA para
       saber que product_ids ya existian. Ese trabajo lo hace ahora el indice
       UNIQUE (tienda, product_id), sin cargar nada en memoria.

    2. El if/elif/else de tres ramas (insertar / mover de coleccion /
       actualizar). Como tienda y categoria son columnas y no contenedores,
       "cambio de categoria" es simplemente otro UPDATE: lo cubre la misma
       sentencia ON CONFLICT.
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
        self.stats = {"insertados": 0, "actualizados": 0, "fallidos": 0}
        spider.logger.info(f"Conectado a Postgres; spider: {spider.name}")

    def close_spider(self, spider):
        self.conn.close()
        spider.logger.info(f"Postgres resumen: {self.stats}")

    def process_item(self, item, spider):
        datos = ItemAdapter(item).asdict()
        enlace = datos.get("enlace", "")
        enlace_normalized = normalizar_enlace(enlace)

        fila = {
            "tienda": datos.get("tienda") or spider.name,
            "product_id": extraer_product_id(enlace, enlace_normalized),
            "nombre": datos.get("nombre"),
            "marca": datos.get("marca"),
            "categoria": datos.get("categoria") or "otros",
            "precio": parse_numero(datos.get("precio")),
            "promocion": parse_numero(datos.get("promocion")),
            "descuento": parse_numero(datos.get("descuento")),
            "calificacion": parse_numero(datos.get("calificacion")),
            "vendedor": datos.get("vendedor"),
            "imagen": datos.get("imagen"),
            "enlace": enlace,
            "enlace_normalized": enlace_normalized,
        }

        try:
            with self.conn.cursor() as cur:
                cur.execute(UPSERT, fila)
                fue_insercion = cur.fetchone()[0]
            self.stats["insertados" if fue_insercion else "actualizados"] += 1
        except psycopg.Error as e:
            spider.logger.error(f"Error guardando '{fila['nombre']}': {e}")
            self.stats["fallidos"] += 1

        return item
