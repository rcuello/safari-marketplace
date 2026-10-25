import type { QuestionDetailRecord } from '@safari/db';
import { toProductDto } from '#src/products/product-dto.mapper.js';
import { toReviewUserDto } from '#src/reviews/review-dto.mapper.js';
import { Question } from './entities/question.entity.js';

/**
 * `QuestionDetailRecord` → las 15 claves del mock de preguntas en su orden
 * (US-55). `deleted_at` y `my_feedback` son constantes (`feedbacks` es un
 * stub); `product` sale de `toProductDto` (V-3) y `user` de la proyección
 * mínima de las reseñas, con `email_verified` (V-4).
 */
export function toQuestionDto(record: QuestionDetailRecord): Question {
  return {
    id: record.id,
    user_id: record.userId,
    shop_id: record.shopId,
    product_id: record.productId,
    question: record.question,
    answer: record.answer,
    deleted_at: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    positive_feedbacks_count: record.positiveFeedbacksCount,
    negative_feedbacks_count: record.negativeFeedbacksCount,
    my_feedback: null,
    abusive_reports_count: record.abusiveReportsCount,
    product: toProductDto(record.product),
    user: toReviewUserDto(record.user, { withEmailVerified: true }),
  } as unknown as Question;
}
