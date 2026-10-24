/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `FaqsService` (US-47). Mismo arnés que
 * `tags.service.spec.ts`: se mockea solo el acceso a datos de `@safari/db` y
 * se dejan REALES las clases de error de dominio y `toWriteHttpException`.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createFaq,
  deleteFaq,
  findFaqById,
  InvalidReferenceError,
  listFaqs,
  RecordNotFoundError,
  updateFaq,
  type FaqRecord,
} from '@safari/db';
import { FaqsService } from './faqs.service';
import { CreateFaqDto } from './dto/create-faq.dto';
import { GetFaqsDto } from './dto/get-faqs.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listFaqs: jest.fn(),
  findFaqById: jest.fn(),
  createFaq: jest.fn(),
  updateFaq: jest.fn(),
  deleteFaq: jest.fn(),
}));

const listFaqsMock = jest.mocked(listFaqs);
const findFaqByIdMock = jest.mocked(findFaqById);
const createFaqMock = jest.mocked(createFaq);
const updateFaqMock = jest.mocked(updateFaq);
const deleteFaqMock = jest.mocked(deleteFaq);

const NOW = new Date('2026-10-20T00:00:00Z');

function makeFaqRecord(overrides: Partial<FaqRecord> = {}): FaqRecord {
  return {
    id: 7,
    faqTitle: 'Titulo',
    slug: 'titulo',
    faqDescription: 'Cuerpo',
    faqType: 'shop',
    issuedBy: 'Furniture Shop',
    shopId: 1,
    userId: null,
    language: 'en',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Sin `transform` en el `ValidationPipe`, la query llega con strings. */
function query(input: Record<string, unknown>): GetFaqsDto {
  return input as unknown as GetFaqsDto;
}

const MOCK_KEYS = [
  'id',
  'faq_title',
  'slug',
  'faq_description',
  'faq_type',
  'issued_by',
  'language',
  'translated_languages',
];

describe('FaqsService', () => {
  let service: FaqsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new FaqsService();
  });

  describe('findAllFaqs', () => {
    it('proyecta las 8 claves del mock en su orden, sin shop_id/user_id/timestamps', async () => {
      listFaqsMock.mockResolvedValue({ items: [makeFaqRecord()], total: 1 });
      const page = await service.findAllFaqs(query({}));
      expect(Object.keys(page.data[0])).toEqual(MOCK_KEYS);
      expect(page.data[0]).toMatchObject({ translated_languages: ['en'] });
    });

    it('traduce los tokens del shop /help a filtros con AND', async () => {
      listFaqsMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllFaqs(
        query({
          limit: '100',
          search: 'faq_type:global;issued_by:Super Admin',
        }),
      );
      expect(listFaqsMock).toHaveBeenCalledWith({
        shopId: undefined,
        faqType: 'global',
        issuedBy: 'Super Admin',
        title: undefined,
        page: 1,
        limit: 100,
      });
    });

    it('acepta shop_id como query o como token del admin', async () => {
      listFaqsMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllFaqs(query({ shop_id: '3' }));
      await service.findAllFaqs(query({ search: 'faq_title:envio;shop_id:4' }));
      expect(listFaqsMock.mock.calls[0][0]).toMatchObject({ shopId: 3 });
      expect(listFaqsMock.mock.calls[1][0]).toMatchObject({
        shopId: 4,
        title: 'envio',
      });
    });

    it('shop_id mal formado no consulta la base y devuelve página vacía', async () => {
      const page = await service.findAllFaqs(query({ shop_id: 'abc' }));
      expect(listFaqsMock).not.toHaveBeenCalled();
      expect(page.data).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('conserva per_page como string y la url base del mock', async () => {
      listFaqsMock.mockResolvedValue({ items: [makeFaqRecord()], total: 1 });
      const page = await service.findAllFaqs(query({ limit: '5' }));
      expect(page.per_page).toBe('5');
      expect(page.first_page_url).toBe(
        'http://localhost:5000/api/faqs?search=undefined&limit=5&page=1',
      );
    });

    it('error de conexión ⇒ 503; cualquier otro ⇒ 500', async () => {
      listFaqsMock.mockRejectedValueOnce(
        Object.assign(new Error("Can't reach database server"), {
          name: 'PrismaClientInitializationError',
        }),
      );
      await expect(service.findAllFaqs(query({}))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      listFaqsMock.mockRejectedValueOnce(new Error('boom'));
      await expect(service.findAllFaqs(query({}))).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('getFaq', () => {
    it('busca por id y proyecta', async () => {
      findFaqByIdMock.mockResolvedValue(makeFaqRecord());
      const faq = await service.getFaq('7');
      expect(findFaqByIdMock).toHaveBeenCalledWith(7);
      expect(Object.keys(faq)).toEqual(MOCK_KEYS);
    });

    it('inexistente o id mal formado ⇒ 404 (V-4)', async () => {
      findFaqByIdMock.mockResolvedValue(null);
      await expect(service.getFaq('999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getFaq('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getFaq('1e21')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findFaqByIdMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('coerciona shop_id, pasa el autor y no deja elegir tipo ni emisor', async () => {
      createFaqMock.mockResolvedValue(makeFaqRecord());
      const dto = {
        faq_title: 'Nueva',
        faq_description: 'x',
        shop_id: '2',
        faq_type: 'global',
        issued_by: 'Otro',
      } as unknown as CreateFaqDto;
      await service.create(dto, 3);
      expect(createFaqMock).toHaveBeenCalledWith({
        faqTitle: 'Nueva',
        faqDescription: 'x',
        shopId: 2,
        userId: 3,
      });
    });

    it('sin shop_id es global (shopId null)', async () => {
      createFaqMock.mockResolvedValue(makeFaqRecord({ shopId: null }));
      await service.create(
        { faq_title: 'G', faq_description: 'x' } as CreateFaqDto,
        3,
      );
      expect(createFaqMock.mock.calls[0][0]).toMatchObject({ shopId: null });
    });

    it('tienda inexistente ⇒ 400', async () => {
      createFaqMock.mockRejectedValue(
        new InvalidReferenceError('faqs', 'shop_id', 999),
      );
      await expect(
        service.create(
          {
            faq_title: 'G',
            faq_description: 'x',
            shop_id: '999',
          } as CreateFaqDto,
          3,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update / remove', () => {
    it('update proyecta campo a campo y devuelve la fila', async () => {
      updateFaqMock.mockResolvedValue(makeFaqRecord({ faqTitle: 'Nuevo' }));
      const faq = await service.update(7, { faq_title: 'Nuevo' });
      expect(updateFaqMock).toHaveBeenCalledWith(7, { faqTitle: 'Nuevo' });
      expect(faq).toMatchObject({ faq_title: 'Nuevo' });
    });

    it('remove devuelve la fila borrada, no un string (V-6)', async () => {
      deleteFaqMock.mockResolvedValue(makeFaqRecord());
      expect(Object.keys(await service.remove(7))).toEqual(MOCK_KEYS);
    });

    it('id mal formado ⇒ 404 sin tocar el driver; inexistente ⇒ 404', async () => {
      await expect(service.update(Number.NaN, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove(0)).rejects.toBeInstanceOf(NotFoundException);
      expect(updateFaqMock).not.toHaveBeenCalled();
      expect(deleteFaqMock).not.toHaveBeenCalled();

      deleteFaqMock.mockRejectedValue(new RecordNotFoundError('faqs', 999));
      await expect(service.remove(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
