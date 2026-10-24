import {
  BecomeSellerOptions,
  CommissionItem,
} from '../entities/become-seller.entity';

/**
 * Forma real del body del `POST` (`BecomeSellerInput`,
 * `apps/admin/rest/src/types/index.ts:2242-2246`): objeto plano, sin `id`
 * ni envoltorio — `page_options` ES el objeto interno de 24 claves, no
 * `{ page_options: <objeto interno> }`. No se deriva de `BecomeSeller` por
 * `OmitType`: el envoltorio de la respuesta y el body del `POST` tienen
 * formas distintas en `page_options` (US-45).
 */
export class CreateBecomeSellerDto {
  language?: string;
  page_options: BecomeSellerOptions;
  commissions: CommissionItem[];
}
