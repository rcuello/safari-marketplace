# Idea — Moneda del marketplace: COP vs USD

> Sin decisión de producto todavía. NO es una US. Documentada aquí para que
> no se pierda ni se resuelva de contrabando dentro de otra US.

**Origen:** `db/README.md` § "Decisión pendiente: la moneda" (verificado
2026-08-25).

## El problema

- `settings.options.currency` es `USD` con 2 decimales (herencia del mock de
  Pickbazar; sus 1200 productos tienen precios de 2 a 421 USD).
- Los precios que scrapea el worker son **pesos colombianos sin decimales**
  (miles de COP).
- Pickbazar asume UNA moneda para todo el marketplace: al convivir seed y
  scraper (Épico 5), los precios se muestran mezclados con una sola etiqueta
  de moneda.

## Las tres salidas conocidas (ninguna es gratis)

1. **Cambiar el setting a COP / es-CO / 0 decimales** — lo más simple; los
   1200 productos del mock quedan mostrándose como si fueran pesos.
2. **Convertir los precios scrapeados a USD al guardar** — coherente con el
   mock; introduce una tasa de cambio a mantener.
3. **Moneda por producto** — lo correcto; se desvía del modelo de Pickbazar y
   obliga a tocar el formateo en el frontend.

## Para promoverla a US

Necesita la decisión del dueño (1/2/3). Con la decisión tomada, redactar la US
con la plantilla del README y numerarla con la secuencia global vigente.
Mientras tanto, el Épico 5 guarda los precios tal como los entrega el
retailer (COP), decisión #4 de su README.
