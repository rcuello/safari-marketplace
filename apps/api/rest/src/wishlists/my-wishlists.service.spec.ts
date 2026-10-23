/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `MyWishlistService` (US-53): delega en
 * `WishlistsService` y solo cambia la url fija del paginador.
 */
import 'reflect-metadata';
import { listWishlistProducts } from '@safari/db';
import { Product } from 'src/products/entities/product.entity';
import { GetWishlistDto } from './dto/get-wishlists.dto';
import { MyWishlistService } from './my-wishlists.service';
import { WishlistsService } from './wishlists.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listWishlistProducts: jest.fn(),
}));

const listMock = jest.mocked(listWishlistProducts);

describe('MyWishlistService', () => {
  let wishlists: WishlistsService;
  let service: MyWishlistService;

  beforeEach(() => {
    jest.resetAllMocks();
    wishlists = new WishlistsService();
    service = new MyWishlistService(wishlists);
  });

  it('la lista usa la url fija de my-wishlists y el usuario que llama', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 });
    const result = await service.findAll(2, {} as GetWishlistDto);
    expect(listMock).toHaveBeenCalledWith(2, { page: 1, limit: 30 });
    expect(result.first_page_url).toBe(
      'http://localhost:5000/api/my-wishlists?with=shop&orderBy=created_at&sortedBy=desc&page=1',
    );
  });

  it.each([
    ['findOne', 'findOne'],
    ['add', 'add'],
    ['remove', 'remove'],
  ] as const)('%s delega en WishlistsService con el mismo usuario e id', async (method, target) => {
    const spy = jest.spyOn(wishlists, target).mockResolvedValue({} as Product);
    await service[method](2, '945');
    expect(spy).toHaveBeenCalledWith(2, '945');
  });
});
