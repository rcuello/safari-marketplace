/**
 * Solicitud de transferencia (US-63). Llegan como string: no hay `transform`
 * en el `ValidationPipe`. El estado no se elige: nace `pending`.
 */
export class CreateOwnershipTransferDto {
  shop_id?: string;
  /** El vendedor que recibiría la tienda. */
  vendor_id?: string;
  message?: string;
}
