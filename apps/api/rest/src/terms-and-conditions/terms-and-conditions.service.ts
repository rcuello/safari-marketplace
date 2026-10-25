import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createTermsAndConditions,
  deleteTermsAndConditions,
  findTermsAndConditionsBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTermsAndConditions,
  setTermsApproval,
  updateTermsAndConditions,
  type ListTermsAndConditionsInput,
  type TermsAndConditionsRecord,
} from '@safari/db';
import { paginate } from '#src/common/pagination/paginate.js';
import { parseSearch } from '#src/common/search/parse-search.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import {
  GetTermsAndConditionsDto,
  TermsAndConditionsPaginator,
} from './dto/get-terms-and-conditions.dto.js';
import { CreateTermsAndConditionsDto } from './dto/create-terms-and-conditions.dto.js';
import { UpdateTermsAndConditionsDto } from './dto/update-terms-and-conditions.dto.js';
import { TermsAndConditions } from './entities/terms-and-conditions.entity.js';

/**
 * `TermsAndConditionsRecord` → las 9 claves de `terms-and-conditions.json`,
 * en su orden. `is_approved` sale como ENTERO 1/0, que es lo que el mock
 * emite en las lecturas (V-7: también tras approve/disapprove, que antes
 * emitían boolean). `shop_id`/`user_id`/timestamps no se emiten (D-1).
 */
function toTermsDto(record: TermsAndConditionsRecord): TermsAndConditions {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    description: record.description,
    type: record.type,
    issued_by: record.issuedBy,
    is_approved: Number(record.isApproved),
    language: record.language,
    translated_languages: ['en'],
  } as unknown as TermsAndConditions;
}

function toShopIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Sin `transform` en el `ValidationPipe`, la query trae `'true'`/`'false'`. */
function toApprovalFilter(raw: unknown): boolean | undefined {
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return undefined;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un término con id ${id}.`);
  }
}

@Injectable()
export class TermsAndConditionsService {
  /**
   * Filtros reales con AND (US-47, V-1). El shop manda `type` reescrito como
   * `type.slug` por `formatSearchParams`; se aceptan las dos claves.
   */
  async findAllTermsAndConditions({
    search,
    limit,
    page,
    is_approved,
    shop_id,
    type,
    issued_by,
  }: GetTermsAndConditionsDto): Promise<TermsAndConditionsPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const url = `/terms-and-conditions?search=${search}&limit=${limit}`;

    const tokens = parseSearch(search);
    const shopId = toShopIdFilter(tokens.shop_id ?? shop_id);
    if (shopId === null) {
      return { data: [], ...paginate(0, page, limit, 0, url) };
    }

    const input: ListTermsAndConditionsInput = {
      shopId,
      type: tokens['type.slug'] ?? tokens.type ?? type,
      issuedBy: tokens.issued_by ?? issued_by,
      title: tokens.title,
      isApproved: toApprovalFilter(is_approved),
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    };

    let result: { items: TermsAndConditionsRecord[]; total: number };
    try {
      result = await listTermsAndConditions(input);
    } catch (error) {
      readError(error);
    }

    const data = result.items.map(toTermsDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por slug, como el mock; inexistente ⇒ 404 (V-4). */
  async findOne(
    param: string,
    _language?: string,
  ): Promise<TermsAndConditions> {
    let record: TermsAndConditionsRecord | null;
    try {
      record = await findTermsAndConditionsBySlug(param);
    } catch (error) {
      readError(error);
    }

    if (!record) {
      throw new NotFoundException(
        `No existe un término con slug \`${param}\`.`,
      );
    }
    return toTermsDto(record);
  }

  /** Aprobado de entrada: solo el super_admin pasa el guard de escritura. */
  async create(
    dto: CreateTermsAndConditionsDto,
    userId?: number,
  ): Promise<TermsAndConditions> {
    try {
      const record = await createTermsAndConditions({
        title: dto.title,
        description: dto.description,
        ...(dto.slug !== undefined && { slug: dto.slug }),
        shopId:
          dto.shop_id == null || dto.shop_id === ''
            ? null
            : Number(dto.shop_id),
        userId: userId ?? null,
        isApproved: true,
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toTermsDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async update(
    id: number,
    dto: UpdateTermsAndConditionsDto,
  ): Promise<TermsAndConditions> {
    assertId(id);
    try {
      const record = await updateTermsAndConditions(id, {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toTermsDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<TermsAndConditions> {
    assertId(id);
    try {
      return toTermsDto(await deleteTermsAndConditions(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Persiste en la base lo que el mock mutaba en memoria (V-7). */
  async disapproveTermsAndCondition(id: unknown): Promise<TermsAndConditions> {
    return this.setApproval(Number(id), false);
  }

  async approveTermsAndCondition(id: unknown): Promise<TermsAndConditions> {
    return this.setApproval(Number(id), true);
  }

  private async setApproval(
    id: number,
    isApproved: boolean,
  ): Promise<TermsAndConditions> {
    assertId(id);
    try {
      return toTermsDto(await setTermsApproval(id, isApproved));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
