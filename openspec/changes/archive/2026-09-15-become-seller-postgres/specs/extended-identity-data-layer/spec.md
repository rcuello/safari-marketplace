# Delta for Extended Identity Data Layer

## MODIFIED Requirements

### Requirement: Exportación por el barrel del paquete

`packages/db/index.ts` MUST re-exportar los tipos `ShopStaffRecord` y
`BecomeSellerRecord` junto al resto de tipos `*Record` del barrel, y MUST
además re-exportar `getBecomeSeller` y `updateBecomeSeller` desde
`packages/db/src/repositories/become-seller.repository.ts` (nuevo, US-44),
junto con el tipo de su input de escritura. El barrel MUST NOT exportar
ninguna función de repositorio de `shop_staff` — ese trabajo sigue
perteneciendo a US-42, todavía no entregado. (CA-4)
(Previously: esta capability no exportaba ninguna función de repositorio
para ninguna de las dos tablas nuevas; ambos agregados quedaban limitados a
tipos y mappers.)

#### Scenario: Los dos tipos son importables desde el barrel

- GIVEN `packages/db/index.ts` tras esta capability
- WHEN otro paquete importa `{ ShopStaffRecord, BecomeSellerRecord }` desde `@safari/db`
- THEN ambos tipos resuelven sin pasar por rutas internas del paquete

#### Scenario: Las funciones de `become_seller` son importables desde el barrel

- GIVEN `packages/db/index.ts` tras esta capability
- WHEN otro paquete importa `{ getBecomeSeller, updateBecomeSeller }` desde `@safari/db`
- THEN ambas funciones resuelven sin pasar por rutas internas del paquete

#### Scenario: El barrel sigue sin exportar funciones de repositorio de `shop_staff`

- GIVEN `packages/db/index.ts` tras esta capability
- WHEN se busca cualquier función exportada de un `shop-staff.repository.ts`
- THEN no existe ninguna: ese archivo pertenece a US-42, no a este change
