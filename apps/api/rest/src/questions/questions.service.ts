import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  answerQuestion,
  createQuestion,
  deleteQuestion,
  findQuestionById,
  findShopOwnerById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  isShopStaff,
  listQuestions,
  type QuestionDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { paginate } from '#src/common/pagination/paginate.js';
import { parseSearch } from '#src/common/search/parse-search.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { GetQuestionDto } from './dto/get-questions.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { Question } from './entities/question.entity.js';
import { toQuestionDto } from './question-dto.mapper.js';

export function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

export function assertQuestionId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe una pregunta con id ${id}.`);
  }
}

/** Entero positivo seguro, o `null` si no lo es. */
function parsePositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

@Injectable()
export class QuestionService {
  /**
   * Filtros reales combinados con AND: `product_id` del query y
   * `question:<texto>` (V-1), `shop_id:N` y `type.slug:<x>` desde `search`.
   * Las demás claves (y `answer`) se ignoran. Un número no válido devuelve la
   * lista vacía. Orden `id DESC`, defaults `page=1`/`limit=10`; la url
   * interpola `answer`, que casi siempre sale `undefined`, como el mock.
   */
  async findAllQuestions({
    limit,
    page,
    search,
    answer,
    product_id,
  }: GetQuestionDto) {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const url = `/questions?search=${search}&answer=${answer}&limit=${limit}`;
    const tokens = parseSearch(search);

    let productId: number | undefined;
    let shopId: number | undefined;
    for (const [raw, set] of [
      [product_id, (n: number) => (productId = n)],
      [tokens.shop_id, (n: number) => (shopId = n)],
    ] as const) {
      if (raw === undefined || raw === '') continue;
      const n = parsePositiveInt(raw);
      if (n === null) return { data: [], ...paginate(0, page, limit, 0, url) };
      set(n);
    }

    try {
      const { items, total } = await listQuestions({
        productId,
        shopId,
        question: tokens.question || undefined,
        typeSlug: tokens['type.slug'] || undefined,
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map(toQuestionDto),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /** DTO o 404. */
  async findQuestion(id: number): Promise<Question> {
    assertQuestionId(id);
    return toQuestionDto(await this.findOrFail(id));
  }

  /**
   * `{question, product_id, shop_id}`; el autor es quien llama y la pregunta
   * nace sin respuesta. 404 si el producto no existe; 400 si `shop_id` no es
   * su tienda o la pregunta está vacía. Lo usan los dos controladores.
   */
  async create(
    dto: CreateQuestionDto,
    user: CurrentUserPayload,
  ): Promise<Question> {
    const productId = parsePositiveInt(dto.product_id);
    const shopId = parsePositiveInt(dto.shop_id);
    if (productId === null) {
      throw new BadRequestException(
        `\`product_id\` no admite \`${String(dto.product_id)}\`.`,
      );
    }
    if (shopId === null) {
      throw new BadRequestException(
        `\`shop_id\` no admite \`${String(dto.shop_id)}\`.`,
      );
    }
    try {
      const record = await createQuestion({
        userId: user.sub,
        productId,
        shopId,
        question: dto.question,
      });
      return toQuestionDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Responder (V-5). `super_admin`, el dueño de la tienda de la pregunta o
   * su staff (fila en `shop_staff`, US-66); si no, 403. El staff se consulta
   * solo si no es dueño. Persiste `answer`, y `question` si llega (el
   * `ReplyQuestion` del admin envía los dos).
   */
  async update(
    id: number,
    dto: UpdateQuestionDto,
    user: CurrentUserPayload,
  ): Promise<Question> {
    assertQuestionId(id);
    const record = await this.findOrFail(id);
    if (
      !(await this.isAdminOrShopOwner(record, user)) &&
      !(await this.isStaff(record, user))
    ) {
      throw new ForbiddenException(
        'Solo el dueño o el staff de la tienda pueden responder esta pregunta.',
      );
    }
    try {
      const updated = await answerQuestion(id, {
        answer: dto.answer ?? null,
        ...(dto.question !== undefined && { question: dto.question }),
      });
      return toQuestionDto(updated);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** El autor, el dueño de la tienda o `super_admin`. Devuelve la pregunta borrada. */
  async delete(id: number, user: CurrentUserPayload): Promise<Question> {
    assertQuestionId(id);
    const record = await this.findOrFail(id);
    if (
      record.userId !== user.sub &&
      !(await this.isAdminOrShopOwner(record, user))
    ) {
      throw new ForbiddenException('No puedes borrar esta pregunta.');
    }
    try {
      return toQuestionDto(await deleteQuestion(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** `super_admin` corta sin consultar; si no, `findShopOwnerById` (precedente products). */
  private async isAdminOrShopOwner(
    record: QuestionDetailRecord,
    user: CurrentUserPayload,
  ): Promise<boolean> {
    if (user.permissions.includes('super_admin')) return true;
    try {
      return (await findShopOwnerById(record.shopId)) === user.sub;
    } catch (error) {
      readError(error);
    }
  }

  /** Solo para responder: el staff no borra preguntas ajenas (US-66, Decisión 3). */
  private async isStaff(
    record: QuestionDetailRecord,
    user: CurrentUserPayload,
  ): Promise<boolean> {
    try {
      return await isShopStaff(user.sub, record.shopId);
    } catch (error) {
      readError(error);
    }
  }

  private async findOrFail(id: number): Promise<QuestionDetailRecord> {
    let record: QuestionDetailRecord | null;
    try {
      record = await findQuestionById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe una pregunta con id ${id}.`);
    }
    return record;
  }
}
