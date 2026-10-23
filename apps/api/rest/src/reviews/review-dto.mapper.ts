import type {
  AbusiveReportDetailRecord,
  ReviewDetailRecord,
  UserRecord,
} from '@safari/db';
import { toProductDto } from 'src/products/product-dto.mapper';
import { Report } from './entities/reports.entity';
import { Review } from './entities/review.entity';

/**
 * Nombre corto que guarda `abusive_reports.model_type` ↔ FQCN de Laravel
 * que publica el contrato (`/my-reports`). El shop reporta con el corto
 * (`review-card.tsx`); se aceptan los dos al escribir.
 */
export const REPORTABLE_FQCN: Record<string, string> = {
  Review: 'Marvel\\Database\\Models\\Review',
  Question: 'Marvel\\Database\\Models\\Question',
};

/** FQCN o nombre corto → nombre corto; `undefined` si no es reportable. */
export function toShortModelType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value in REPORTABLE_FQCN) return value;
  return Object.keys(REPORTABLE_FQCN).find((short) => REPORTABLE_FQCN[short] === value);
}

/**
 * Autor embebido en reseñas y reportes, con la forma mínima del mock:
 * `is_active` como NÚMERO y `shop_id: null`. No es el `toUserDto` de
 * `users/user-dto.mapper.ts`, que emite otra forma. Los timestamps son los
 * de `users` (V-3). Las preguntas (US-55) añaden `email_verified` al final;
 * las reseñas no lo traen.
 */
export function toReviewUserDto(
  user: UserRecord,
  { withEmailVerified = false }: { withEmailVerified?: boolean } = {},
): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified_at: user.emailVerifiedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    is_active: user.isActive ? 1 : 0,
    shop_id: null,
    ...(withEmailVerified && { email_verified: user.emailVerifiedAt !== null }),
  };
}

/**
 * `ReviewDetailRecord` → las 18 claves del mock de reseñas en su orden (US-54).
 * `deleted_at` y `my_feedback` son constantes (D-6: `feedbacks` es un stub);
 * `product` sale de `toProductDto` (V-2).
 */
export function toReviewDto(record: ReviewDetailRecord): Review {
  return {
    id: record.id,
    order_id: record.orderId,
    user_id: record.userId,
    shop_id: record.shopId,
    product_id: record.productId,
    variation_option_id: record.variationOptionId,
    comment: record.comment,
    rating: record.rating,
    photos: record.photos,
    deleted_at: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    positive_feedbacks_count: record.positiveFeedbacksCount,
    negative_feedbacks_count: record.negativeFeedbacksCount,
    my_feedback: null,
    abusive_reports_count: record.abusiveReportsCount,
    product: toProductDto(record.product),
    user: toReviewUserDto(record.user),
  } as unknown as Review;
}

/** `AbusiveReportDetailRecord` → la forma del mock de reportes, con `model_type` FQCN. */
export function toReportDto(record: AbusiveReportDetailRecord): Report {
  return {
    id: record.id,
    user_id: record.userId,
    model_type: REPORTABLE_FQCN[record.modelType] ?? record.modelType,
    model_id: record.modelId,
    message: record.message,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    user: toReviewUserDto(record.user),
  } as unknown as Report;
}
