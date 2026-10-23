import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';
import { OrderStatusType, PaymentStatusType } from '../entities/order.entity';
import { CreateOrderDto } from './create-order.dto';

/**
 * V-9 (US-59): el admin cambia el estado con `{ order_status }`
 * (`pages/orders/[orderId]/index.tsx`), un campo que `CreateOrderDto` no
 * declara. Un valor fuera del enum da 400 antes de llegar al servicio.
 */
export class UpdateOrderDto extends PartialType(CreateOrderDto) {
  @IsOptional()
  @IsIn(Object.values(OrderStatusType))
  order_status?: OrderStatusType;

  @IsOptional()
  @IsIn(Object.values(PaymentStatusType))
  payment_status?: PaymentStatusType;
}
