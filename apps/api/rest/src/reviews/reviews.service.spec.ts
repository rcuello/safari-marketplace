/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `ReviewService` (US-54). Solo se mockea el acceso a
 * datos; los proyectores son los reales.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createReview,
  deleteReview,
  findReviewById,
  InvalidFieldValueError,
  listReviews,
  RecordNotFoundError,
  SlugConflictError,
  updateReview,
  type ProductRecord,
  type ReviewDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { GetReviewsDto } from './dto/get-reviews.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewService } from './reviews.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listReviews: jest.fn(),
  findReviewById: jest.fn(),
  createReview: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
}));

const listMock = jest.mocked(listReviews);
const findMock = jest.mocked(findReviewById);
const createMock = jest.mocked(createReview);
const updateMock = jest.mocked(updateReview);
const deleteMock = jest.mocked(deleteReview);

const NOW = new Date('2022-03-18T09:06:12.000Z');

const AUTHOR: CurrentUserPayload = {
  sub: 4,
  email: 'customer2@demo.com',
  permissions: ['customer'],
  iat: 0,
  exp: 0,
};
const OTHER: CurrentUserPayload = {
  ...AUTHOR,
  sub: 5,
  email: 'customer3@demo.com',
};
const ADMIN: CurrentUserPayload = {
  sub: 3,
  email: 'admin@demo.com',
  permissions: ['super_admin', 'customer', 'store_owner'],
  iat: 0,
  exp: 0,
};

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

function makeRecord(
  overrides: Partial<ReviewDetailRecord> = {},
): ReviewDetailRecord {
  return {
    id: 85,
    orderId: null,
    userId: 4,
    shopId: 6,
    productId: 1,
    variationOptionId: null,
    comment: 'Muy bueno',
    rating: 5,
    photos: [],
    positiveFeedbacksCount: 0,
    negativeFeedbacksCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    user: {
      id: 4,
      name: 'customer2',
      email: 'customer2@demo.com',
      isActive: true,
      emailVerifiedAt: null,
      createdAt: new Date('2022-03-17T14:15:08.000Z'),
      updatedAt: new Date('2022-03-17T14:15:08.000Z'),
    },
    product: PRODUCT,
    abusiveReportsCount: 0,
    ...overrides,
  };
}

describe('ReviewService', () => {
  let service: ReviewService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ReviewService();
  });

  describe('DTO', () => {
    it('emite las 18 claves del mock en su orden, con el autor mínimo e is_active numérico', async () => {
      findMock.mockResolvedValue(makeRecord({ abusiveReportsCount: 1 }));
      const dto = JSON.parse(JSON.stringify(await service.findReview(85)));
      expect(Object.keys(dto)).toEqual([
        'id',
        'order_id',
        'user_id',
        'shop_id',
        'product_id',
        'variation_option_id',
        'comment',
        'rating',
        'photos',
        'deleted_at',
        'created_at',
        'updated_at',
        'positive_feedbacks_count',
        'negative_feedbacks_count',
        'my_feedback',
        'abusive_reports_count',
        'product',
        'user',
      ]);
      expect(dto).toMatchObject({
        deleted_at: null,
        my_feedback: null,
        abusive_reports_count: 1,
      });
      expect(dto.created_at).toBe('2022-03-18T09:06:12.000Z');
      expect(Object.keys(dto.product)).toHaveLength(20);
      expect(dto.user).toEqual({
        id: 4,
        name: 'customer2',
        email: 'customer2@demo.com',
        email_verified_at: null,
        created_at: '2022-03-17T14:15:08.000Z',
        updated_at: '2022-03-17T14:15:08.000Z',
        is_active: 1,
        shop_id: null,
      });
    });

    it('id desconocido o no válido ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(service.findReview(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findReview(Number.NaN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAllReviews', () => {
    it('combina product_id con rating, shop_id y type.slug de search; ignora el resto', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const result = await service.findAllReviews({
        product_id: '1',
        search: 'rating:5;shop_id:6;type.slug:grocery;foo:bar',
        limit: '5',
        page: '1',
      } as unknown as GetReviewsDto);
      expect(listMock).toHaveBeenCalledWith({
        productId: 1,
        shopId: 6,
        rating: 5,
        typeSlug: 'grocery',
        page: 1,
        limit: 5,
      });
      expect(result.per_page).toBe('5');
      expect(result.first_page_url).toBe(
        'http://localhost:5000/api/reviews?search=rating:5;shop_id:6;type.slug:grocery;foo:bar&limit=5&page=1',
      );
    });

    it('defaults page=1/limit=30 y search vacío sin filtros', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      const result = await service.findAllReviews({
        search: '',
      } as GetReviewsDto);
      expect(listMock).toHaveBeenCalledWith({
        productId: undefined,
        shopId: undefined,
        rating: undefined,
        typeSlug: undefined,
        page: 1,
        limit: 30,
      });
      expect(result.per_page).toBe(30);
    });

    it.each([
      [{ search: 'rating:cinco' }],
      [{ product_id: 'abc' }],
      [{ search: 'shop_id:-1' }],
    ])(
      'un número no válido (%j) devuelve la lista vacía sin consultar',
      async (query) => {
        const result = await service.findAllReviews(query as GetReviewsDto);
        expect(listMock).not.toHaveBeenCalled();
        expect(result.total).toBe(0);
      },
    );

    it('un token sin `:` se ignora en vez de dar 500', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllReviews({ search: 'rating' } as GetReviewsDto);
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ rating: undefined }),
      );
    });

    it('un fallo de conexión es 503', async () => {
      listMock.mockRejectedValue(
        Object.assign(new Error('down'), {
          name: 'PrismaClientInitializationError',
        }),
      );
      await expect(
        service.findAllReviews({} as GetReviewsDto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('create', () => {
    const DTO = {
      product_id: '1',
      shop_id: '6',
      rating: 4,
      comment: 'zz',
      order_id: null,
      variation_option_id: null,
    } as unknown as CreateReviewDto;

    it('el autor es quien llama y los ids se convierten', async () => {
      createMock.mockResolvedValue(makeRecord());
      await service.create(DTO, AUTHOR);
      expect(createMock).toHaveBeenCalledWith({
        userId: 4,
        productId: 1,
        shopId: 6,
        rating: 4,
        comment: 'zz',
        orderId: null,
        variationOptionId: null,
      });
    });

    it('mapea los errores del repositorio a 404, 400 y 409', async () => {
      createMock.mockRejectedValueOnce(new RecordNotFoundError('products', 1));
      await expect(service.create(DTO, AUTHOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      createMock.mockRejectedValueOnce(
        new InvalidFieldValueError(
          'reviews',
          'shop_id',
          9,
          'tienda del producto 1',
        ),
      );
      await expect(service.create(DTO, AUTHOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      createMock.mockRejectedValueOnce(
        new SlugConflictError('reviews', 'user_id, product_id, order_id'),
      );
      await expect(service.create(DTO, AUTHOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('sin product_id o con ids no numéricos ⇒ 400 sin escribir', async () => {
      for (const bad of [
        { product_id: undefined },
        { shop_id: 'x' },
        { order_id: 'x' },
      ]) {
        await expect(
          service.create(
            { ...DTO, ...bad } as unknown as CreateReviewDto,
            AUTHOR,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('update / delete', () => {
    it('el autor edita solo rating, comment y photos', async () => {
      findMock.mockResolvedValue(makeRecord());
      updateMock.mockResolvedValue(makeRecord({ rating: 2 }));
      await service.update(
        85,
        { rating: 2, comment: 'x', shop_id: '1' } as UpdateReviewDto,
        AUTHOR,
      );
      expect(updateMock).toHaveBeenCalledWith(85, { rating: 2, comment: 'x' });
    });

    it('otro usuario ⇒ 403 sin escribir; super_admin puede', async () => {
      findMock.mockResolvedValue(makeRecord());
      await expect(
        service.update(85, { rating: 1 }, OTHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.delete(85, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
      deleteMock.mockResolvedValue(makeRecord());
      expect((await service.delete(85, ADMIN)).id).toBe(85);
    });

    it('reseña inexistente ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(
        service.update(85, { rating: 1 }, AUTHOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.delete(85, ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
