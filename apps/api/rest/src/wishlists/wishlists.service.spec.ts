/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `WishlistsService` (US-53). Mismo arnés que
 * `coupons.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  addToWishlist,
  findWishlistProduct,
  isInWishlist,
  listWishlistProducts,
  RecordNotFoundError,
  removeFromWishlist,
  toggleWishlist,
  type ProductRecord,
} from '@safari/db';
import { toProductDto } from 'src/products/product-dto.mapper';
import { CreateWishlistDto } from './dto/create-wishlists.dto';
import { GetWishlistDto } from './dto/get-wishlists.dto';
import { WishlistsService } from './wishlists.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listWishlistProducts: jest.fn(),
  findWishlistProduct: jest.fn(),
  isInWishlist: jest.fn(),
  addToWishlist: jest.fn(),
  removeFromWishlist: jest.fn(),
  toggleWishlist: jest.fn(),
}));

const listMock = jest.mocked(listWishlistProducts);
const findMock = jest.mocked(findWishlistProduct);
const inMock = jest.mocked(isInWishlist);
const addMock = jest.mocked(addToWishlist);
const removeMock = jest.mocked(removeFromWishlist);
const toggleMock = jest.mocked(toggleWishlist);

const NOW = new Date('2026-10-22T00:00:00Z');
const CUSTOMER = 2;

function makeProductRecord(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: 945,
    name: 'Producto 945',
    slug: 'producto-945',
    description: null,
    typeId: 1,
    shopId: 7,
    manufacturerId: null,
    productType: 'simple',
    price: 10,
    salePrice: null,
    minPrice: 10,
    maxPrice: 10,
    quantity: 5,
    inStock: true,
    soldQuantity: 0,
    sku: null,
    unit: '1 pc',
    status: 'publish',
    visibility: 'visibility_public',
    image: null,
    gallery: [],
    ratings: 0,
    totalReviews: 0,
    isTaxable: false,
    isDigital: false,
    isExternal: false,
    externalProductUrl: null,
    language: 'en',
    translatedLanguages: ['en'],
    sourceStore: null,
    sourceProductId: null,
    sourceUrl: null,
    scrapedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    type: {
      id: 1,
      name: 'Grocery',
      slug: 'grocery',
      icon: null,
      settings: {},
      banners: [],
      language: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    },
    shop: {
      id: 7,
      name: 'Shop 7',
      slug: 'shop-7',
      description: null,
      ownerId: 1,
      isActive: true,
      logo: null,
      coverImage: null,
      address: {},
      settings: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    manufacturer: null,
    categories: [],
    tags: [],
    ...overrides,
  };
}

describe('WishlistsService', () => {
  let service: WishlistsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new WishlistsService();
  });

  describe('findAll', () => {
    it('lista del usuario que llama, proyectada con toProductDto, defaults del mock', async () => {
      const record = makeProductRecord();
      listMock.mockResolvedValue({ items: [record], total: 1 });
      const result = await service.findAll(CUSTOMER, {} as GetWishlistDto);
      expect(listMock).toHaveBeenCalledWith(CUSTOMER, { page: 1, limit: 30 });
      expect(result.data).toEqual([toProductDto(record)]);
      expect(result.per_page).toBe(30);
      expect(result.first_page_url).toBe(
        'http://localhost:5000/api/wishlists?with=shop&orderBy=created_at&sortedBy=desc&page=1',
      );
    });

    it('ignora orderBy/sortedBy/search y pasa page/limit numéricos', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAll(CUSTOMER, {
        page: '2',
        limit: '5',
        search: 'name:x',
        orderBy: 'NAME',
      } as unknown as GetWishlistDto);
      expect(listMock).toHaveBeenCalledWith(CUSTOMER, { page: 2, limit: 5 });
    });

    it('un fallo de conexión es 503', async () => {
      listMock.mockRejectedValue(
        Object.assign(new Error('down'), { name: 'PrismaClientInitializationError' }),
      );
      await expect(service.findAll(CUSTOMER, {} as GetWishlistDto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('findOne', () => {
    it('el producto si está en la lista; si no, 404', async () => {
      findMock.mockResolvedValue(makeProductRecord());
      expect((await service.findOne(CUSTOMER, '945')).id).toBe(945);
      expect(findMock).toHaveBeenCalledWith(CUSTOMER, 945);
      findMock.mockResolvedValue(null);
      await expect(service.findOne(CUSTOMER, '945')).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['abc', '0', '-1', '1.5', String(Number.MAX_SAFE_INTEGER + 2)])(
      'id %s ⇒ 400 sin consultar (US-31)',
      async (id) => {
        await expect(service.findOne(CUSTOMER, id)).rejects.toBeInstanceOf(BadRequestException);
        expect(findMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('escrituras', () => {
    it('add devuelve el producto proyectado; producto inexistente ⇒ 404', async () => {
      addMock.mockResolvedValue(makeProductRecord({ id: 3 }));
      expect((await service.add(CUSTOMER, 3)).id).toBe(3);
      expect(addMock).toHaveBeenCalledWith(CUSTOMER, 3);
      addMock.mockRejectedValue(new RecordNotFoundError('products', 999999));
      await expect(service.add(CUSTOMER, 999999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove devuelve el producto; si no estaba ⇒ 404', async () => {
      removeMock.mockResolvedValue(makeProductRecord({ id: 3 }));
      expect((await service.remove(CUSTOMER, '3')).id).toBe(3);
      removeMock.mockRejectedValue(new RecordNotFoundError('wishlists', 3));
      await expect(service.remove(CUSTOMER, '3')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('toggle devuelve el booleano desnudo del estado nuevo', async () => {
      toggleMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const dto = { product_id: '2' } as CreateWishlistDto;
      expect(await service.toggle(CUSTOMER, dto)).toBe(true);
      expect(await service.toggle(CUSTOMER, dto)).toBe(false);
      expect(toggleMock).toHaveBeenCalledWith(CUSTOMER, 2);
    });

    it('toggle sobre un producto inexistente ⇒ 404; sin product_id ⇒ 400', async () => {
      toggleMock.mockRejectedValue(new RecordNotFoundError('products', 999999));
      await expect(
        service.toggle(CUSTOMER, { product_id: '999999' } as CreateWishlistDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.toggle(CUSTOMER, {} as CreateWishlistDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('isInWishlist devuelve true/false del usuario que llama', async () => {
    inMock.mockResolvedValue(false);
    expect(await service.isInWishlist(3, '945')).toBe(false);
    expect(inMock).toHaveBeenCalledWith(3, 945);
  });
});
