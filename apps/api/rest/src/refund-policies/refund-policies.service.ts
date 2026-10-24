import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createRefundPolicy,
  deleteRefundPolicy,
  findRefundPolicyBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listRefundPolicies,
  updateRefundPolicy,
  type ListRefundPoliciesInput,
  type RefundPolicyRecord,
} from '@safari/db';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { RefundPolicy } from './entities/refund-policies.entity';
import { CreateRefundPolicyDto } from './dto/create-refund-policy.dto';
import {
  GetRefundPolicyDto,
  RefundPolicyPaginator,
} from './dto/get-refund-policies.dto';
import { UpdateRefundPolicyDto } from './dto/update-refund-policy.dto';

/**
 * `RefundPolicyRecord` → las 8 claves de `refund-policies.json`, en su
 * orden. `shop_id` y los timestamps tienen columna pero el mock no los
 * emite (US-48, D-1). `translated_languages` es constante (D-6).
 */
function toRefundPolicyDto(record: RefundPolicyRecord): RefundPolicy {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    target: record.target,
    status: record.status,
    description: record.description,
    language: record.language,
    translated_languages: ['en'],
  } as unknown as RefundPolicy;
}

function toShopIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toOptionalShopId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  return raw === null || raw === '' ? null : Number(raw);
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
      `No existe una política de reembolso con id ${id}.`,
    );
  }
}

@Injectable()
export class RefundPoliciesService {
  /**
   * Filtros reales con AND (US-48, V-1/V-2): el shop manda
   * `search=target:customer;status:approved`. El mock aplicaba Fuse con el
   * último token (`approved`) sobre `title` y servía las 5 con `total: 0`.
   */
  async findAllRefundPolicies({
    search,
    limit,
    page,
  }: GetRefundPolicyDto): Promise<RefundPolicyPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const url = `/refund-policies?search=${search}&limit=${limit}`;

    const tokens = parseSearch(search);
    const shopId = toShopIdFilter(tokens.shop_id);
    if (shopId === null) {
      return { data: [], ...paginate(0, page, limit, 0, url) };
    }

    const input: ListRefundPoliciesInput = {
      target: tokens.target,
      status: tokens.status,
      title: tokens.title,
      shopId,
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    };

    let result: { items: RefundPolicyRecord[]; total: number };
    try {
      result = await listRefundPolicies(input);
    } catch (error) {
      readError(error);
    }

    const data = result.items.map(toRefundPolicyDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por slug, como el mock; inexistente ⇒ 404 (V-3). */
  async getRefundPolicy(
    param: string,
    language?: string,
  ): Promise<RefundPolicy> {
    let record: RefundPolicyRecord | null;
    try {
      record = await findRefundPolicyBySlug(param);
    } catch (error) {
      readError(error);
    }

    if (!record) {
      throw new NotFoundException(
        `No existe una política de reembolso con slug \`${param}\`.`,
      );
    }
    return toRefundPolicyDto(record);
  }

  /**
   * El admin envía `{title, slug, target, status, language, description}`
   * (`refund-policy-form.tsx:124-140`); `slug` es la fuente del slug si
   * llega no vacío. `status` ausente ⇒ `pending` (DEFAULT de la tabla).
   */
  async create(dto: CreateRefundPolicyDto): Promise<RefundPolicy> {
    try {
      const shopId = toOptionalShopId(dto.shop_id);
      const record = await createRefundPolicy({
        title: dto.title,
        target: dto.target,
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(shopId !== undefined && { shopId }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toRefundPolicyDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** El `slug` del body se ignora: es inmutable. */
  async update(id: number, dto: UpdateRefundPolicyDto): Promise<RefundPolicy> {
    assertId(id);
    try {
      const shopId = toOptionalShopId(dto.shop_id);
      const record = await updateRefundPolicy(id, {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.target !== undefined && { target: dto.target }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(shopId !== undefined && { shopId }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toRefundPolicyDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve la política borrada (V-4: el mock devolvía un string). */
  async remove(id: number): Promise<RefundPolicy> {
    assertId(id);
    try {
      return toRefundPolicyDto(await deleteRefundPolicy(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
