/**
 * Query de las 3 listas del dashboard (US-61). El admin manda además
 * `language`, `searchJoin` y `with`, que se aceptan y se ignoran.
 */
export class GetAnalyticsListDto {
  /** Default 10. */
  limit?: string;
  /** Solo se entiende `shop_id:N`. */
  search?: string;
}
