/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `QuestionService` (US-55). Solo se mockea el acceso a
 * datos; los proyectores son los reales.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  answerQuestion,
  createQuestion,
  deleteQuestion,
  findQuestionById,
  findShopOwnerById,
  InvalidFieldValueError,
  listQuestions,
  RecordNotFoundError,
  type ProductRecord,
  type QuestionDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CreateQuestionDto } from './dto/create-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionService } from './questions.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listQuestions: jest.fn(),
  findQuestionById: jest.fn(),
  createQuestion: jest.fn(),
  answerQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  findShopOwnerById: jest.fn(),
}));

const listMock = jest.mocked(listQuestions);
const findMock = jest.mocked(findQuestionById);
const createMock = jest.mocked(createQuestion);
const answerMock = jest.mocked(answerQuestion);
const deleteMock = jest.mocked(deleteQuestion);
const ownerMock = jest.mocked(findShopOwnerById);

const AT = new Date('2022-03-18T10:19:46.000Z');

const user = (sub: number, permissions: string[]): CurrentUserPayload => ({
  sub,
  email: `u${sub}@demo.com`,
  permissions,
  iat: 0,
  exp: 0,
});
const OWNER = user(1, ['store_owner', 'customer']);
const CUSTOMER = user(2, ['customer']);
const ADMIN = user(3, ['super_admin', 'customer', 'store_owner']);

const PRODUCT = {
  id: 1,
  name: 'Apples',
  slug: 'apples',
  language: 'en',
  translatedLanguages: ['en'],
  productType: 'simple',
  salePrice: null,
  maxPrice: 2,
  minPrice: 2,
  image: null,
  status: 'publish',
  price: 2,
  quantity: 20,
  unit: '1lb',
  sku: null,
  soldQuantity: 0,
  visibility: 'visibility_public',
  type: { id: 1, name: 'Grocery', slug: 'grocery', settings: {} },
  shop: { id: 6, name: 'Grocery Shop', slug: 'grocery-shop', logo: null },
} as unknown as ProductRecord;

function makeRecord(overrides: Partial<QuestionDetailRecord> = {}): QuestionDetailRecord {
  return {
    id: 68,
    userId: 2,
    shopId: 6,
    productId: 1,
    question: '¿Son orgánicas?',
    answer: 'Sí',
    positiveFeedbacksCount: 0,
    negativeFeedbacksCount: 0,
    createdAt: AT,
    updatedAt: AT,
    user: {
      id: 2,
      name: 'Customer',
      email: 'customer@demo.com',
      isActive: true,
      emailVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
    product: PRODUCT,
    abusiveReportsCount: 0,
    ...overrides,
  };
}

describe('QuestionService', () => {
  let service: QuestionService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new QuestionService();
  });

  describe('DTO', () => {
    it('emite las 15 claves del mock en su orden; el user lleva email_verified al final', async () => {
      findMock.mockResolvedValue(makeRecord({ abusiveReportsCount: 1 }));
      const dto = JSON.parse(JSON.stringify(await service.findQuestion(68)));
      expect(Object.keys(dto)).toEqual([
        'id', 'user_id', 'shop_id', 'product_id', 'question', 'answer', 'deleted_at', 'created_at',
        'updated_at', 'positive_feedbacks_count', 'negative_feedbacks_count', 'my_feedback',
        'abusive_reports_count', 'product', 'user',
      ]);
      expect(dto).toMatchObject({ deleted_at: null, my_feedback: null, abusive_reports_count: 1 });
      expect(Object.keys(dto.product)).toHaveLength(20);
      expect(Object.keys(dto.user)).toEqual([
        'id', 'name', 'email', 'email_verified_at', 'created_at', 'updated_at', 'is_active',
        'shop_id', 'email_verified',
      ]);
      expect(dto.user).toMatchObject({ is_active: 1, shop_id: null, email_verified: false });
    });

    it('pregunta desconocida o id no válido ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(service.findQuestion(999)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findQuestion(Number.NaN)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllQuestions', () => {
    it('combina product_id con question, shop_id y type.slug; url con answer=undefined', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const result = await service.findAllQuestions({
        product_id: '1',
        search: 'question:apple;shop_id:6;type.slug:grocery;foo:bar',
        limit: '5',
      } as unknown as GetQuestionDto);
      expect(listMock).toHaveBeenCalledWith({
        productId: 1,
        shopId: 6,
        question: 'apple',
        typeSlug: 'grocery',
        page: 1,
        limit: 5,
      });
      expect(result.per_page).toBe('5');
      expect(result.first_page_url).toBe(
        'http://localhost:5000/api/questions?search=question:apple;shop_id:6;type.slug:grocery;foo:bar&answer=undefined&limit=5&page=1',
      );
    });

    it('defaults page=1/limit=10', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      const result = await service.findAllQuestions({ search: '' } as GetQuestionDto);
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10, question: undefined }));
      expect(result.per_page).toBe(10);
    });

    it('un número no válido devuelve la lista vacía sin consultar', async () => {
      const result = await service.findAllQuestions({ product_id: 'abc' } as GetQuestionDto);
      expect(listMock).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
    });

    it('un fallo de conexión es 503', async () => {
      listMock.mockRejectedValue(
        Object.assign(new Error('down'), { name: 'PrismaClientInitializationError' }),
      );
      await expect(service.findAllQuestions({} as GetQuestionDto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('create', () => {
    const DTO = { question: 'zz', product_id: '1', shop_id: '6' } as unknown as CreateQuestionDto;

    it('el autor es quien llama', async () => {
      createMock.mockResolvedValue(makeRecord({ answer: null }));
      const result = await service.create(DTO, CUSTOMER);
      expect(createMock).toHaveBeenCalledWith({ userId: 2, productId: 1, shopId: 6, question: 'zz' });
      expect(result.answer).toBeNull();
    });

    it('ids no válidos ⇒ 400 sin escribir; errores del repositorio ⇒ 404/400', async () => {
      await expect(
        service.create({ ...DTO, shop_id: 'x' } as unknown as CreateQuestionDto, CUSTOMER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
      createMock.mockRejectedValueOnce(new RecordNotFoundError('products', 1));
      await expect(service.create(DTO, CUSTOMER)).rejects.toBeInstanceOf(NotFoundException);
      createMock.mockRejectedValueOnce(
        new InvalidFieldValueError('questions', 'shop_id', 9, 'tienda del producto 1'),
      );
      await expect(service.create(DTO, CUSTOMER)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update = responder', () => {
    it('el dueño de la tienda responde; persiste answer y question si llega', async () => {
      findMock.mockResolvedValue(makeRecord());
      ownerMock.mockResolvedValue(1);
      answerMock.mockResolvedValue(makeRecord({ answer: 'Nueva' }));
      const result = await service.update(
        68,
        { id: 68, answer: 'Nueva', question: '¿Son orgánicas?' } as unknown as UpdateQuestionDto,
        OWNER,
      );
      expect(ownerMock).toHaveBeenCalledWith(6);
      expect(answerMock).toHaveBeenCalledWith(68, { answer: 'Nueva', question: '¿Son orgánicas?' });
      expect(result.answer).toBe('Nueva');
    });

    it('super_admin responde sin consultar la tienda', async () => {
      findMock.mockResolvedValue(makeRecord());
      answerMock.mockResolvedValue(makeRecord());
      await service.update(68, { answer: 'x' } as UpdateQuestionDto, ADMIN);
      expect(ownerMock).not.toHaveBeenCalled();
      expect(answerMock).toHaveBeenCalledWith(68, { answer: 'x' });
    });

    it('el cliente (aunque sea el autor) ⇒ 403 sin escribir', async () => {
      findMock.mockResolvedValue(makeRecord());
      ownerMock.mockResolvedValue(1);
      await expect(
        service.update(68, { answer: 'x' } as UpdateQuestionDto, CUSTOMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(answerMock).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('lo pueden borrar el autor, el dueño de la tienda o super_admin; otro ⇒ 403', async () => {
      findMock.mockResolvedValue(makeRecord());
      deleteMock.mockResolvedValue(makeRecord());
      ownerMock.mockResolvedValue(1);
      for (const who of [CUSTOMER, OWNER, ADMIN]) {
        expect((await service.delete(68, who)).id).toBe(68);
      }
      await expect(service.delete(68, user(5, ['customer']))).rejects.toBeInstanceOf(ForbiddenException);
      expect(deleteMock).toHaveBeenCalledTimes(3);
    });

    it('pregunta inexistente ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(service.delete(68, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
