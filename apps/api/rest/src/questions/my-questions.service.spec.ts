/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `MyQuestionsService` (US-55): todo es del usuario que
 * llama y lo ajeno es 404.
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import {
  deleteQuestion,
  findQuestionById,
  listUserQuestions,
  updateQuestionText,
  type ProductRecord,
  type QuestionDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CreateQuestionDto } from './dto/create-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { Question } from './entities/question.entity';
import { MyQuestionsService } from './my-questions.service';
import { QuestionService } from './questions.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listUserQuestions: jest.fn(),
  findQuestionById: jest.fn(),
  updateQuestionText: jest.fn(),
  deleteQuestion: jest.fn(),
}));

const listMock = jest.mocked(listUserQuestions);
const findMock = jest.mocked(findQuestionById);
const updateMock = jest.mocked(updateQuestionText);
const deleteMock = jest.mocked(deleteQuestion);

const AT = new Date('2022-03-18T10:19:46.000Z');

function makeRecord(
  overrides: Partial<QuestionDetailRecord> = {},
): QuestionDetailRecord {
  return {
    id: 34,
    userId: 4,
    shopId: 6,
    productId: 1,
    question: 'apple?',
    answer: 'sí',
    positiveFeedbacksCount: 0,
    negativeFeedbacksCount: 0,
    createdAt: AT,
    updatedAt: AT,
    user: {
      id: 4,
      name: 'customer2',
      email: 'customer2@demo.com',
      isActive: true,
      emailVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
    product: {
      id: 1,
      type: { id: 1, name: 'Grocery', slug: 'grocery', settings: {} },
      shop: { id: 6, name: 'Grocery Shop', slug: 'grocery-shop', logo: null },
    } as unknown as ProductRecord,
    abusiveReportsCount: 0,
    ...overrides,
  };
}

describe('MyQuestionsService', () => {
  let questions: QuestionService;
  let service: MyQuestionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    questions = new QuestionService();
    service = new MyQuestionsService(questions);
  });

  it('lista solo las del usuario, limit 8 por defecto y la url fija del mock', async () => {
    listMock.mockResolvedValue({ items: [makeRecord()], total: 14 });
    const result = await service.findMyQuestions(4, {
      search: 'answer:x',
    } as GetQuestionDto);
    expect(listMock).toHaveBeenCalledWith(4, { page: 1, limit: 8 });
    expect(result.total).toBe(14);
    expect(result.per_page).toBe(8);
    expect(result.first_page_url).toBe(
      'http://localhost:5000/api/my-questions?with=user&orderBy=created_at&sortedBy=desc&page=1',
    );
  });

  it('una pregunta ajena o inexistente es 404 en lectura, edición y borrado', async () => {
    findMock.mockResolvedValue(makeRecord({ userId: 4 }));
    await expect(service.findMyQuestion(2, 34)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update(2, 34, { question: 'x' } as UpdateQuestionDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(2, 34)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    findMock.mockResolvedValue(null);
    await expect(service.findMyQuestion(4, 34)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('el autor lee, edita el texto (no la respuesta) y borra la suya', async () => {
    findMock.mockResolvedValue(makeRecord());
    expect((await service.findMyQuestion(4, 34)).id).toBe(34);
    updateMock.mockResolvedValue(makeRecord({ question: 'nueva' }));
    await service.update(4, 34, {
      question: 'nueva',
      answer: 'trampa',
    } as UpdateQuestionDto);
    expect(updateMock).toHaveBeenCalledWith(34, 'nueva');
    deleteMock.mockResolvedValue(makeRecord());
    expect((await service.delete(4, 34)).id).toBe(34);
  });

  it('crear delega en QuestionService con el usuario que llama', async () => {
    const spy = jest
      .spyOn(questions, 'create')
      .mockResolvedValue({} as Question);
    const dto = {
      question: 'zz',
      product_id: '1',
      shop_id: '6',
    } as unknown as CreateQuestionDto;
    const who: CurrentUserPayload = {
      sub: 2,
      email: 'c@demo.com',
      permissions: ['customer'],
      iat: 0,
      exp: 0,
    };
    await service.create(dto, who);
    expect(spy).toHaveBeenCalledWith(dto, who);
  });
});
