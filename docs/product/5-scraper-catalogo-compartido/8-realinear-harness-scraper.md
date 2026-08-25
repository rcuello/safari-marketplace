# US-8 — Realinear el harness del scraper (`db-test`, `db-count`)

> `test_pipeline.py` y las recetas `just db-test` / `just db-count` vuelven a
> ser verdaderas: prueban y cuentan contra `products`, no contra la tabla
> muerta `productos`.

**Épico:** [Épico 5](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** US-6
**LOC est.:** ~150

## Historia
**Como** agente (o estudiante) que necesita verificar el pipeline sin salir a
internet, **quiero** que `just db-test` ejercite el pipeline real contra el
esquema real, **para** tener un gate honesto del scraper en local y en el
futuro CI.

## Contexto

- `test_pipeline.py` prueba hoy el contrato viejo (columnas en español,
  upsert por `(tienda, product_id)`): tras US-6 quedaría probando código que
  ya no existe, o rojo.
- `just db-count` (justfile:296) consulta `FROM productos` — falla contra la
  base actual.
- Las 4 propiedades que el test viejo cubría siguen siendo las correctas
  (insertar / actualizar sin duplicar / cambio de categoría en la misma fila /
  mismo product_id en dos tiendas sin pisarse); cambia la tabla y llegan las
  nuevas: procedencia, shops/manufacturers get-or-create, constraints.

## Scope
**Incluye:** reescribir `test_pipeline.py` contra el pipeline de US-6 (las 4
propiedades originales + CA-2/CA-4 de US-6), actualizar la receta `db-count`
del justfile a una consulta equivalente sobre `products` (por `source_store` y
categoría), y dejar `just db-test` verde de punta a punta tras `just db-up`.
**NO incluye:** tocar `pipelines.py` (salvo bug encontrado por el test —
reportarlo y arreglarlo como fix mínimo documentado), tests de los spiders
contra los sitios reales, CI (Épico 9).

## Criterios de aceptación

### CA-1 — `just db-test` verde contra el esquema real
Tras `just db-up`, `just db-test` sale 0 ejercitando el pipeline de US-6
contra la tabla `products` real (sin mocks de la base).

### CA-2 — Las 4 propiedades originales, portadas
Insertar / actualizar-sin-duplicar / cambio de categoría en una sola fila /
mismo `source_product_id` en dos `source_store` distintos: las 4 pasan.

### CA-3 — `just db-count` cuenta lo que hay
`just db-count` responde con el desglose por tienda (source_store o su shop) y
categoría sobre `products`, sin error, con el seed cargado y con filas del
scraper presentes.

### CA-4 — El test limpia lo suyo
El test no deja residuos que alteren corridas siguientes ni rompan el seed
(idempotencia del harness: dos `just db-test` seguidos, ambos verdes).

## Escenarios Gherkin
```gherkin
Feature: Harness honesto del scraper
  Scenario: CA-1 — gate local verde
    Given just db-up ejecutado
    When corro just db-test dos veces seguidas
    Then ambas corridas salen 0
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `services/scraper-worker/test_pipeline.py` | reescritura contra `products` + propiedades nuevas |
| `justfile` | receta `db-count` sobre `products`; `db-test` solo si cambia la invocación |

## Definición de Done
- [ ] Salida real de `just db-test` (dos corridas) pegada.
- [ ] Salida real de `just db-count` pegada.
- [ ] Salida real de `just --list` intacta (el justfile sigue parseando).
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Esta US toca el `justfile`, que es compartido por todo el repo: cambio
  mínimo, solo las recetas nombradas.
- Si US-6 dejó un script sintético temporal para su DoD, esta US lo reemplaza
  por `test_pipeline.py` formal — no mantener dos harnesses.
