# US-87 — SDKs de Stripe (servidor y cliente)

> Sube el SDK de servidor (`stripe` 11.18.0 → 23.x) en la API y los de
> cliente (`@stripe/stripe-js` 2.1.11 → 10.x, `@stripe/react-stripe-js`
> 2.8.1 → 7.x) en el shop. El pago hoy es un mock, así que el riesgo
> real está en la compilación y en el checkout de prueba.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-78 (API en Nest 11) y US-83 (React 19)
**LOC est.:** ~150

## Historia

**Como** mantenedor, **quiero** los SDKs de Stripe al día, **para** que el
día que el pago deje de ser mock no haya que saltar 12 versiones mayores
de golpe.

## Contexto — verificado (2026-10-24)

- **API:** `apps/api/rest/src/payment/stripe-payment.service.ts` es el
  único archivo que importa `stripe`. `src/payment/` no tiene controlador y
  lee JSON (ver `CLAUDE.md`). `payment-intent` y `payment-method` también
  son mocks permanentes (US-74, «Los 7 archivos que hoy importan el mock»).
- **Shop:** 8 archivos de `apps/shop/src` importan `@stripe/*`.

## Scope

**Incluye:** las tres librerías en su última mayor, y los cambios de tipos
y de API que exijan en los archivos que las importan.

**NO incluye:** conectar Stripe de verdad ni cambiar el mock del pago.

## Criterios de aceptación

### CA-1 — Compila y pasa

`just build-api` y `npx jest` de la API pasan con las cifras de la línea
base. `just build` del shop termina sin errores.

### CA-2 — Checkout de prueba

En el shop, el checkout llega al formulario de pago. El componente de
Stripe se monta sin errores de consola, aunque no haya clave pública
configurada; ese caso tiene que degradar igual que hoy.

## Escenarios Gherkin

```gherkin
Feature: SDKs de Stripe al día
  Scenario: CA-2 — el formulario de pago se monta
    Given el shop con los SDKs nuevos
    When el usuario llega al paso de pago
    Then el formulario se muestra como antes y la consola no muestra errores nuevos
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | `stripe` |
| `apps/api/rest/src/payment/stripe-payment.service.ts` | tipos y API |
| `apps/shop/package.json`, `apps/yarn.lock` | `@stripe/*` |
| los 8 archivos del shop que importan `@stripe/*` | tipos y API |

## Definición de Done

- [ ] Línea base del checkout (consola y capturas).
- [ ] CA-1 y CA-2 con la salida pegada.
- [ ] Lint sin escribir en 0 en la API y sin hallazgos nuevos en el shop.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- El SDK de servidor fija una `apiVersion` por mayor. Anota cuál queda y si
  el mock depende de alguna forma de respuesta concreta.
