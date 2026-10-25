import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createFaq,
  deleteFaq,
  findFaqById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listFaqs,
  updateFaq,
  type FaqRecord,
  type ListFaqsInput,
} from '@safari/db';
import { paginate } from '#src/common/pagination/paginate.js';
import { parseSearch } from '#src/common/search/parse-search.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { GetFaqsDto, FaqPaginator } from './dto/get-faqs.dto.js';
import { CreateFaqDto } from './dto/create-faq.dto.js';
import { UpdateFaqDto } from './dto/update-faq.dto.js';
import { Faq } from './entities/faq.entity.js';

/**
 * `FaqRecord` → las 8 claves de `faqs.json`, en su orden. `shop_id`,
 * `user_id` y los timestamps tienen columna pero el mock NO los emite, así
 * que tampoco aquí (US-47, D-1). `translated_languages` es constante (D-6).
 */
function toFaqDto(record: FaqRecord): Faq {
  return {
    id: record.id,
    faq_title: record.faqTitle,
    slug: record.slug,
    faq_description: record.faqDescription,
    faq_type: record.faqType,
    issued_by: record.issuedBy,
    language: record.language,
    translated_languages: ['en'],
  } as unknown as Faq;
}

/** `shop_id` de query o de token; uno mal formado no casa con ninguna tienda. */
function toShopIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

@Injectable()
export class FaqsService {
  /**
   * Filtros reales con AND (US-47, V-1): el mock aplicaba Fuse con el último
   * token sobre todo el array y, con la página vacía, servía las primeras N
   * con `total: 0`. `shop_id` llega como query (shop) o como token (admin);
   * `faq_type` e `issued_by` llegan dentro de `search` desde el shop.
   * `page`/`limit` se pasan crudos a `paginate()` para conservar
   * `per_page` como string cuando el cliente manda `limit` (Decision A).
   */
  async findAllFaqs({
    search,
    limit,
    page,
    shop_id,
    faq_type,
    issued_by,
  }: GetFaqsDto): Promise<FaqPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const url = `/faqs?search=${search}&limit=${limit}`;

    const tokens = parseSearch(search);
    const shopId = toShopIdFilter(tokens.shop_id ?? shop_id);
    if (shopId === null) {
      return { data: [], ...paginate(0, page, limit, 0, url) };
    }

    const input: ListFaqsInput = {
      shopId,
      faqType: tokens.faq_type ?? faq_type,
      issuedBy: tokens.issued_by ?? issued_by,
      title: tokens.faq_title,
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    };

    let result: { items: FaqRecord[]; total: number };
    try {
      result = await listFaqs(input);
    } catch (error) {
      readError(error);
    }

    const data = result.items.map(toFaqDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por id, como el mock; inexistente o id mal formado ⇒ 404 (V-4). */
  async getFaq(param: string, _language?: string): Promise<Faq> {
    const id = Number(param);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una FAQ con id \`${param}\`.`);
    }

    let record: FaqRecord | null;
    try {
      record = await findFaqById(id);
    } catch (error) {
      readError(error);
    }

    if (!record) {
      throw new NotFoundException(`No existe una FAQ con id \`${param}\`.`);
    }
    return toFaqDto(record);
  }

  /**
   * El tipo y el emisor los deriva el repositorio de `shop_id` (el admin no
   * los envía). `user_id` es el usuario del token. `shop_id` se coerciona:
   * sin `transform` en el `ValidationPipe` llega como string.
   */
  async create(createFaqDto: CreateFaqDto, userId?: number): Promise<Faq> {
    try {
      const record = await createFaq({
        faqTitle: createFaqDto.faq_title,
        faqDescription: createFaqDto.faq_description,
        shopId:
          createFaqDto.shop_id == null || createFaqDto.shop_id === ''
            ? null
            : Number(createFaqDto.shop_id),
        userId: userId ?? null,
        ...(createFaqDto.language !== undefined && {
          language: createFaqDto.language,
        }),
      });
      return toFaqDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Guarda de id de US-31 antes de tocar el driver. */
  async update(id: number, updateFaqDto: UpdateFaqDto): Promise<Faq> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una FAQ con id ${id}.`);
    }

    try {
      const record = await updateFaq(id, {
        ...(updateFaqDto.faq_title !== undefined && {
          faqTitle: updateFaqDto.faq_title,
        }),
        ...(updateFaqDto.faq_description !== undefined && {
          faqDescription: updateFaqDto.faq_description,
        }),
        ...(updateFaqDto.language !== undefined && {
          language: updateFaqDto.language,
        }),
      });
      return toFaqDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve la FAQ borrada (V-6: el mock devolvía un string). */
  async remove(id: number): Promise<Faq> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una FAQ con id ${id}.`);
    }

    try {
      return toFaqDto(await deleteFaq(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
