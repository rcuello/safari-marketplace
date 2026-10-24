import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createRefundReason,
  deleteRefundReason,
  findRefundReasonBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listRefundReasons,
  updateRefundReason,
  type RefundReasonRecord,
} from '@safari/db';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { RefundReason } from './entities/refund-reasons.entity';
import { UpdateRefundReasonDto } from './dto/update-refund-reasons.dto';
import {
  GetRefundReasonDto,
  RefundReasonPaginator,
} from './dto/get-refund-reasons.dto';
import { CreateRefundReasonDto } from './dto/create-refund-reasons.dto';

/**
 * `RefundReasonRecord` → las 8 claves de `refund-reasons.json`, en su orden.
 * Es el primer módulo del épico que EMITE timestamps: salen del seed (las
 * fechas del mock) y `Date.toJSON()` da los mismos 3 decimales que el mock ya
 * emitía vía `@Type(() => Date)`. `deleted_at` es constante `null` entre
 * `updated_at` y `translated_languages` (D-6: no hay soft delete).
 */
function toRefundReasonDto(record: RefundReasonRecord): RefundReason {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    language: record.language,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: null,
    translated_languages: ['en'],
  } as unknown as RefundReason;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(
      `No existe un motivo de reembolso con id ${id}.`,
    );
  }
}

@Injectable()
export class RefundReasonsService {
  /**
   * Filtro por `name`. El token `type.slug` que manda el shop se ignora: no
   * hay columna `type` y el mock tampoco filtraba por él (US-48).
   */
  async findAll({
    search,
    limit,
    page,
  }: GetRefundReasonDto): Promise<RefundReasonPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const url = `/refund-reasons?search=${search}&limit=${limit}`;

    const tokens = parseSearch(search);
    let result: { items: RefundReasonRecord[]; total: number };
    try {
      result = await listRefundReasons({
        name: tokens.name,
        page: Number(page) || 1,
        limit: Number(limit) || 10,
      });
    } catch (error) {
      readError(error);
    }

    const data = result.items.map(toRefundReasonDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por slug, como el mock; inexistente ⇒ 404 (V-3). */
  async getRefundReason(
    param: string,
    language?: string,
  ): Promise<RefundReason> {
    let record: RefundReasonRecord | null;
    try {
      record = await findRefundReasonBySlug(param);
    } catch (error) {
      readError(error);
    }

    if (!record) {
      throw new NotFoundException(
        `No existe un motivo de reembolso con slug \`${param}\`.`,
      );
    }
    return toRefundReasonDto(record);
  }

  /** El admin envía `{name, slug, language}` (`refund-reason-form.tsx`). */
  async create(dto: CreateRefundReasonDto): Promise<RefundReason> {
    try {
      const record = await createRefundReason({
        name: dto.name,
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toRefundReasonDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** `updated_at` pasa a `now()` de `clock.ts` (V-5); el `slug` es inmutable. */
  async update(id: number, dto: UpdateRefundReasonDto): Promise<RefundReason> {
    assertId(id);
    try {
      const record = await updateRefundReason(id, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toRefundReasonDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<RefundReason> {
    assertId(id);
    try {
      return toRefundReasonDto(await deleteRefundReason(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
