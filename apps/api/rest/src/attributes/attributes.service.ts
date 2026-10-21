import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createAttribute,
  deleteAttribute,
  findAttributeByIdOrSlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listAttributes,
  updateAttribute,
  type AttributeRecord,
  type AttributeValueInput,
} from '@safari/db';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { AttributeValueDto, CreateAttributeDto } from './dto/create-attribute.dto';
import { GetAttributesArgs } from './dto/get-attributes.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { Attribute } from './entities/attribute.entity';

/**
 * `AttributeRecord` → la forma de `attributes.json`, con el orden de claves
 * del mock en los DOS niveles (US-50, D-1). `type` es constante todo `null`
 * (no hay `type_id`); `translated_languages` es constante (D-6); el mock no
 * trae timestamps y no se emiten.
 */
function toAttributeDto(record: AttributeRecord): Attribute {
  return {
    id: record.id,
    name: record.name,
    shop_id: record.shopId,
    language: record.language,
    translated_languages: ['en'],
    slug: record.slug,
    type: { id: null, name: null, slug: null, logo: null },
    values: record.values.map((v) => ({
      id: v.id,
      value: v.value,
      attribute_id: v.attributeId,
      slug: v.slug,
      meta: v.meta,
      language: v.language,
      translated_languages: ['en'],
    })),
  } as unknown as Attribute;
}

/**
 * El admin manda `values[].id` como `Number(id)`: un valor nuevo llega como
 * `null` (NaN serializado). Cualquier cosa que no sea número queda en `null`
 * y el repositorio la trata como valor nuevo.
 */
function toValueInputs(values: AttributeValueDto[] | undefined): AttributeValueInput[] | undefined {
  if (values === undefined) return undefined;
  return values.map((v) => ({
    id: typeof v.id === 'number' ? v.id : null,
    value: v.value,
    ...(v.meta !== undefined && { meta: v.meta }),
    ...(v.language !== undefined && { language: v.language }),
  }));
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un atributo con id ${id}.`);
  }
}

@Injectable()
export class AttributesService {
  /** Padre y valores en un solo nested write: una tienda inexistente no deja basura. */
  async create(dto: CreateAttributeDto): Promise<Attribute> {
    try {
      const record = await createAttribute({
        name: dto.name,
        shopId: Number(dto.shop_id),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.language !== undefined && { language: dto.language }),
        values: toValueInputs(dto.values) ?? [],
      });
      return toAttributeDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * ARRAY sin paginar, como el mock (`attributeClient.all` lo espera así).
   * `search=shop_id:N` filtra por tienda (V-1) y `name:X` por nombre; el
   * token `type.slug` se ignora: no hay `type`.
   */
  async findAll({ search, shop_id }: GetAttributesArgs = {}): Promise<Attribute[]> {
    const tokens = parseSearch(search);
    const rawShopId = tokens.shop_id ?? shop_id;
    let shopId: number | undefined;
    if (rawShopId !== undefined && rawShopId !== '') {
      shopId = Number(rawShopId);
      if (!Number.isSafeInteger(shopId) || shopId <= 0) return [];
    }

    try {
      return (await listAttributes({ shopId, name: tokens.name })).map(toAttributeDto);
    } catch (error) {
      readError(error);
    }
  }

  /** Por id o por slug, como el mock; inexistente ⇒ 404 (V-2). */
  async findOne(param: string): Promise<Attribute> {
    let record: AttributeRecord | null;
    try {
      record = await findAttributeByIdOrSlug(param);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un atributo con id o slug \`${param}\`.`);
    }
    return toAttributeDto(record);
  }

  /**
   * Reconcilia los valores con el body (ver `attributes.repository.ts`).
   * `shop_id` y `slug` del body se ignoran: no cambian tras crear.
   */
  async update(id: number, dto: UpdateAttributeDto): Promise<Attribute> {
    assertId(id);
    try {
      const record = await updateAttribute(id, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.values !== undefined && { values: toValueInputs(dto.values) }),
      });
      return toAttributeDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve el atributo borrado con sus valores (V-3: el mock daba un string). */
  async remove(id: number): Promise<Attribute> {
    assertId(id);
    try {
      return toAttributeDto(await deleteAttribute(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
