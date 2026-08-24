"""Prueba del PostgresPipeline sin salir a internet.

Alimenta el pipeline con items sinteticos y comprueba contra la base que:

  1. Un producto nuevo se INSERTA, con el precio convertido de "1.299.900 COP"
     a un numero sobre el que se puede hacer aritmetica.
  2. El mismo producto visto otra vez con otro precio se ACTUALIZA en lugar de
     duplicarse (lo hace el UNIQUE (tienda, product_id) + ON CONFLICT).
  3. Un producto que cambia de categoria sigue siendo UNA sola fila. En Mongo
     esto exigia borrar el documento de una coleccion e insertarlo en otra.
  4. Dos tiendas distintas pueden usar el mismo product_id sin pisarse.

Uso:  just db-test
"""
import os
import sys

import psycopg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelines import PostgresPipeline, parse_numero  # noqa: E402


class SpiderFalso:
    """Lo minimo que el pipeline espera de un spider real."""

    name = "prueba"

    def __init__(self, dsn):
        self.settings = {"DATABASE_URL": dsn}
        self.logger = self

    def info(self, msg):
        pass

    def error(self, msg):
        print(f"  [error del pipeline] {msg}")


def item(**kwargs):
    base = {
        "nombre": "Portatil generico",
        "marca": "ACME",
        "precio": "1.299.900 COP",
        "categoria": "portatiles",
        "enlace": "https://tienda.com/product/12345/portatil",
        "imagen": "https://tienda.com/img.jpg",
        "tienda": "Alkosto",
    }
    base.update(kwargs)
    return base


fallos = []


def check(descripcion, condicion, detalle=""):
    if condicion:
        print(f"  OK    {descripcion}")
    else:
        print(f"  FALLA {descripcion}  {detalle}")
        fallos.append(descripcion)


def main():
    dsn = os.environ.get(
        "DATABASE_URL", "postgresql://safari:safari@localhost:5433/safari_scraper"
    )

    # ── Conversion de texto a numero, sin tocar la base ──────────────────
    print("\nConversion de precios (lo que Mongo nunca obligo a hacer):")
    check('"1.299.900 COP" -> 1299900', parse_numero("1.299.900 COP") == 1299900,
          f'dio {parse_numero("1.299.900 COP")}')
    check('"$ 89.900,50"   -> 89900.50', parse_numero("$ 89.900,50") == 89900.50,
          f'dio {parse_numero("$ 89.900,50")}')
    check('"44%"           -> 44', parse_numero("44%") == 44,
          f'dio {parse_numero("44%")}')
    check("None            -> None", parse_numero(None) is None)
    check('"sin precio"    -> None', parse_numero("sin precio") is None)

    # ── Limpieza previa ──────────────────────────────────────────────────
    with psycopg.connect(dsn, autocommit=True) as c:
        c.execute("DELETE FROM productos WHERE tienda IN ('Alkosto','Exito')")

    spider = SpiderFalso(dsn)
    pipe = PostgresPipeline()
    pipe.open_spider(spider)

    print("\nComportamiento del pipeline:")

    # 1. Insercion
    pipe.process_item(item(), spider)
    with psycopg.connect(dsn) as c:
        fila = c.execute(
            "SELECT precio, categoria, nombre FROM productos "
            "WHERE tienda='Alkosto' AND product_id='12345'"
        ).fetchone()
    check("producto nuevo se inserta", fila is not None)
    check("precio quedo numerico y operable", fila and fila[0] == 1299900,
          f"dio {fila[0] if fila else None}")

    # 2. Actualizacion, no duplicado
    pipe.process_item(item(precio="1.100.000 COP", nombre="Portatil rebajado"), spider)
    with psycopg.connect(dsn) as c:
        n = c.execute(
            "SELECT count(*) FROM productos WHERE tienda='Alkosto' AND product_id='12345'"
        ).fetchone()[0]
        precio, nombre = c.execute(
            "SELECT precio, nombre FROM productos "
            "WHERE tienda='Alkosto' AND product_id='12345'"
        ).fetchone()
    check("volver a verlo no duplica la fila", n == 1, f"hay {n} filas")
    check("el precio se actualizo", precio == 1100000, f"dio {precio}")
    check("el nombre se actualizo", nombre == "Portatil rebajado")

    # 3. Cambio de categoria
    pipe.process_item(item(categoria="gaming"), spider)
    with psycopg.connect(dsn) as c:
        n = c.execute(
            "SELECT count(*) FROM productos WHERE tienda='Alkosto' AND product_id='12345'"
        ).fetchone()[0]
        cat = c.execute(
            "SELECT categoria FROM productos "
            "WHERE tienda='Alkosto' AND product_id='12345'"
        ).fetchone()[0]
    check("cambiar de categoria no duplica", n == 1, f"hay {n} filas")
    check("la categoria quedo actualizada", cat == "gaming", f"dio {cat}")

    # 4. Mismo product_id en otra tienda
    pipe.process_item(item(tienda="Exito", nombre="Otro producto"), spider)
    with psycopg.connect(dsn) as c:
        n = c.execute("SELECT count(*) FROM productos WHERE product_id='12345'").fetchone()[0]
    check("dos tiendas pueden compartir product_id", n == 2, f"hay {n} filas")

    # 5. Un producto claramente mas barato, para que la consulta de abajo
    #    compare precios entre tiendas y no sea una demo vacia.
    pipe.process_item(
        item(
            tienda="Exito",
            nombre="Portatil economico",
            precio="$ 899.900",
            promocion="799.900 COP",
            descuento="11%",
            enlace="https://tienda.com/product/99999/economico",
        ),
        spider,
    )

    pipe.close_spider(spider)
    check("estadisticas del pipeline", pipe.stats["fallidos"] == 0, f"{pipe.stats}")

    # ── Lo que ahora se puede preguntar y antes no ──────────────────────
    print("\nConsultas que con precios en texto eran imposibles:")
    with psycopg.connect(dsn) as c:
        baratos = c.execute(
            "SELECT nombre, tienda, precio FROM productos "
            "WHERE precio < 1200000 ORDER BY precio"
        ).fetchall()
        medio = c.execute(
            "SELECT round(avg(precio)) FROM productos WHERE tienda IN ('Alkosto','Exito')"
        ).fetchone()[0]
        ahorro = c.execute(
            "SELECT nombre, precio - promocion FROM productos "
            "WHERE promocion IS NOT NULL ORDER BY precio - promocion DESC LIMIT 1"
        ).fetchone()

    print("  WHERE precio < 1200000 ORDER BY precio")
    for f in baratos:
        print(f"    {f[2]:>12,.0f} COP  {f[1]:<10} {f[0]}")
    print(f"  AVG(precio) -> {medio:,.0f} COP")
    print(f"  mayor ahorro -> {ahorro[0]}: {ahorro[1]:,.0f} COP")

    check("WHERE precio < 1200000 devuelve resultados", len(baratos) > 0)
    check("AVG(precio) se puede calcular", medio is not None)
    check("resta precio - promocion funciona", ahorro is not None and ahorro[1] == 100000,
          f"dio {ahorro[1] if ahorro else None}")

    print()
    if fallos:
        print(f"FALLARON {len(fallos)} comprobaciones")
        return 1
    print("Todas las comprobaciones pasaron")
    return 0


if __name__ == "__main__":
    sys.exit(main())
