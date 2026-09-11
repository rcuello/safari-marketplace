# Delta for Category Tree API

## MODIFIED Requirements

### Requirement: Borrado re-enraíza a las hijas y devuelve el snapshot pre-borrado (CA-3)

`DELETE /categories/:id` MUST borrar la fila y responder con las 16 claves
de `toCategoryDto`, proyectadas sobre el nodo capturado **antes** del
borrado. Las hijas MUST re-enraizarse (`parent_id NULL`, vía
`ON DELETE SET NULL`) y aparecer como raíces en
`GET /categories?parent=null`; sus enlaces `category_product` MUST
desaparecer. Un `GET /categories/:id` posterior MUST responder 404.
**Divergencia declarada**: el `children` de la respuesta refleja el árbol
**pre-borrado** (parent_id antiguo), aunque en la base ya está re-enraizado.

#### Scenario: CA-3 — borrar una madre re-enraíza a sus hijas
- GIVEN una categoría `M` con hijas `H1` y `H2`
- WHEN `DELETE /categories/M`
- THEN la respuesta es 200 con `children` mostrando `H1`/`H2` con su
  `parent_id` previo
- AND `GET /categories/H1` devuelve `parent: null`, y `GET /categories/M`
  responde 404

#### Scenario: CA-3 — los enlaces de producto desaparecen (COMPLIANT, cerrado por US-29)
- GIVEN una categoría centinela (creada vía `POST /categories`, nunca una
  del seed) enlazada, a través de su pivote `categories`, a un producto
  creado por `createProduct` (`product-write-api`, US-29)
- WHEN `DELETE /categories/:id`
- THEN `count(*) FROM category_product WHERE category_id = :id` es 0
- AND el producto sigue existiendo — solo su enlace con esa categoría
  desaparece

**Estado real: COMPLIANT, no `UNTESTED`.** `product-write-api` (US-29)
implementó `createProduct`, la primera ruta HTTP capaz de poblar
`category_product`. La evidencia `psql` de esta US — sobre una categoría
centinela ligada a un producto también centinela (prefijo de slug
`zz-products-`, D29-9), nunca sobre una fila del seed — confirma que el
`ON DELETE CASCADE` preexistente de `category_product_category_id_fkey`
sigue produciendo el efecto: 0 filas tras el borrado, sin código nuevo en
`categories`. El escenario deja de estar `UNTESTED (verificación diferida a
US-29)`; la obligación que archivó US-28 queda cerrada.
(Previously: el segundo escenario estaba marcado
`UNTESTED (verificación diferida a US-29)`, sin evidencia real porque no
existía ninguna ruta de escritura capaz de poblar `category_product`.)
