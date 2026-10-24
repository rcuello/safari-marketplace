/**
 * Cuerpo de `POST /abusive_reports/reject` (US-65). `model_id` es el id del
 * objeto reportado (la reseña), no el de un reporte. `model_type` es
 * opcional: hoy el admin no lo manda (ver DD-3 de la US) y vale `Review`.
 */
export class RejectReportDto {
  model_id?: unknown;
  model_type?: unknown;
}
