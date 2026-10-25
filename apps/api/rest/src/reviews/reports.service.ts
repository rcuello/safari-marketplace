import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createAbusiveReport,
  deleteAbusiveReport,
  findAbusiveReportById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listAbusiveReports,
  rejectAbusiveReports,
  updateAbusiveReport,
  type AbusiveReportDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { RejectReportDto } from './dto/reject-report.dto.js';
import { UpdateReportDto } from './dto/update-report.dto.js';
import { Report } from './entities/reports.entity.js';
import {
  REPORTABLE_FQCN,
  toReportDto,
  toShortModelType,
} from './review-dto.mapper.js';

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un reporte con id ${id}.`);
  }
}

/**
 * Reportes de abuso (US-54). Antes las 5 rutas devolvían cadenas (V-6).
 * La moderación (lista, detalle, edición y borrado) es del admin; reportar
 * es de cualquier usuario autenticado.
 */
@Injectable()
export class AbusiveReportService {
  /** `{data: [...]}` de todos, `id DESC`. */
  async findAllReports(): Promise<{ data: Report[] }> {
    try {
      return { data: (await listAbusiveReports()).map(toReportDto) };
    } catch (error) {
      readError(error);
    }
  }

  async findReport(id: number): Promise<Report> {
    assertId(id);
    let record: AbusiveReportDetailRecord | null;
    try {
      record = await findAbusiveReportById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un reporte con id ${id}.`);
    }
    return toReportDto(record);
  }

  /**
   * `model_type` acepta el nombre corto (lo que envía el shop) o el FQCN. El
   * repositorio valida que el objeto exista: una reseña o pregunta
   * (US-55) inexistente es 404. Reportar dos veces lo mismo es 409.
   */
  async create(
    dto: CreateReportDto,
    user: CurrentUserPayload,
  ): Promise<Report> {
    const modelType = toShortModelType(dto.model_type);
    if (!modelType) {
      throw new BadRequestException(
        `\`model_type\` no admite \`${String(dto.model_type)}\`.`,
      );
    }
    const modelId = Number(dto.model_id);
    if (!Number.isSafeInteger(modelId) || modelId <= 0) {
      throw new BadRequestException(
        `\`model_id\` no admite \`${String(dto.model_id)}\`.`,
      );
    }
    try {
      const record = await createAbusiveReport({
        userId: user.sub,
        modelType,
        modelId,
        message: dto.message,
      });
      return toReportDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Rechazar (US-65): borra todos los reportes del objeto y lo deja intacto.
   * `model_type` corto o FQCN; si falta vale `Review`, que es lo que llega
   * hoy del admin (no recibe `abusive_reports` en el detalle). Objeto
   * inexistente ⇒ 404; `model_id` o `model_type` inválidos ⇒ 400; sin
   * reportes ⇒ `deleted: 0`.
   */
  async reject(
    dto: RejectReportDto,
  ): Promise<{ model_type: string; model_id: number; deleted: number }> {
    const modelType =
      dto.model_type == null ? 'Review' : toShortModelType(dto.model_type);
    if (!modelType) {
      throw new BadRequestException(
        `\`model_type\` no admite \`${String(dto.model_type)}\`.`,
      );
    }
    const modelId = Number(dto.model_id);
    if (
      dto.model_id == null ||
      !Number.isSafeInteger(modelId) ||
      modelId <= 0
    ) {
      throw new BadRequestException(
        `\`model_id\` no admite \`${String(dto.model_id)}\`.`,
      );
    }
    try {
      const deleted = await rejectAbusiveReports(modelType, modelId);
      return {
        model_type: REPORTABLE_FQCN[modelType],
        model_id: modelId,
        deleted,
      };
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Solo `message`. */
  async update(id: number, dto: UpdateReportDto): Promise<Report> {
    assertId(id);
    try {
      return toReportDto(
        await updateAbusiveReport(id, { message: dto.message }),
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async delete(id: number): Promise<Report> {
    assertId(id);
    try {
      return toReportDto(await deleteAbusiveReport(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
