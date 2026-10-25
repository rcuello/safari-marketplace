import { Coupon } from '../entities/coupon.entity.js';

export class VerifyCouponInput {
  code: string;
  /** Subtotal del carrito; ausente o no numérico cuenta como 0 (US-52). */
  sub_total?: number;
  item?: unknown[];
}
export class VerifyCouponResponse {
  is_valid: boolean;
  coupon: Coupon;
}
