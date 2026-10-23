import { Injectable, NotFoundException } from '@nestjs/common';
import {
  deleteQuestion,
  findQuestionById,
  listUserQuestions,
  updateQuestionText,
  type QuestionDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateQuestionDto } from './dto/create-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { Question } from './entities/question.entity';
import { toQuestionDto } from './question-dto.mapper';
import { assertQuestionId, QuestionService, readError } from './questions.service';

export const MY_QUESTIONS_URL = '/my-questions?with=user&orderBy=created_at&sortedBy=desc';

/**
 * «Mis preguntas» (US-55): solo las del usuario que llama (V-2, corrección
 * de privacidad: antes devolvía las 68 a cualquiera). Una pregunta ajena es
 * 404, no 403: desde aquí no existe.
 */
@Injectable()
export class MyQuestionsService {
  constructor(private readonly questionService: QuestionService) {}

  /** `created_at DESC, id DESC`; defaults `page=1`/`limit=8` y la url fija del mock. */
  async findMyQuestions(userId: number, { limit, page }: GetQuestionDto) {
    if (!page) page = 1;
    if (!limit) limit = 8;
    try {
      const { items, total } = await listUserQuestions(userId, {
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map(toQuestionDto),
        ...paginate(total, page, limit, items.length, MY_QUESTIONS_URL),
      };
    } catch (error) {
      readError(error);
    }
  }

  async findMyQuestion(userId: number, id: number): Promise<Question> {
    return toQuestionDto(await this.findOwn(userId, id));
  }

  create(dto: CreateQuestionDto, user: CurrentUserPayload): Promise<Question> {
    return this.questionService.create(dto, user);
  }

  /** El autor edita el texto de su pregunta; la respuesta no se toca. */
  async update(userId: number, id: number, dto: UpdateQuestionDto): Promise<Question> {
    await this.findOwn(userId, id);
    try {
      return toQuestionDto(await updateQuestionText(id, dto.question));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async delete(userId: number, id: number): Promise<Question> {
    await this.findOwn(userId, id);
    try {
      return toQuestionDto(await deleteQuestion(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  private async findOwn(userId: number, id: number): Promise<QuestionDetailRecord> {
    assertQuestionId(id);
    let record: QuestionDetailRecord | null;
    try {
      record = await findQuestionById(id);
    } catch (error) {
      readError(error);
    }
    if (!record || record.userId !== userId) {
      throw new NotFoundException(`No existe una pregunta tuya con id ${id}.`);
    }
    return record;
  }
}
