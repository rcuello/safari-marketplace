/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios del mapeo de errores de base en los 2 endpoints de shops
 * migrados en US-5 (`getNewShops`, `getNearByShop`).
 *
 * Cierra el MUST "Errores de conexión a Postgres" de la spec
 * `derived-catalog-api` para el lado de shops: ambos métodos replican el
 * mismo `try/catch` a mano que los de products, así que sin esto una
 * regresión del mapeo 503/500 pasaba inadvertida.
 *
 * Mismo arnés que `products.service.spec.ts`: se mockea SOLO el acceso a
 * datos (`listShops` / `listShopsNear`) y se dejan REALES
 * `isPrismaConnectionError` / `getUserFriendlyMessage` (jest.requireActual),
 * para que la clasificación del error se pruebe de verdad y sin base.
 */
import 'reflect-metadata';
import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { listShops, listShopsNear } from '@safari/db';
import { ShopsService } from './shops.service';
import { GetShopsDto } from './dto/get-shops.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy).
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listShops: jest.fn(),
  listShopsNear: jest.fn(),
}));

const listShopsMock = jest.mocked(listShops);
const listShopsNearMock = jest.mocked(listShopsNear);

/**
 * `ValidationPipe` corre sin `transform`: en runtime los query params llegan
 * como strings crudos aunque el DTO declare números. Mismo cast-precedente
 * que usa `products.service.spec.ts`.
 */
function rawQuery(
  query: Record<string, string | number | undefined>,
): GetShopsDto {
  return query as unknown as GetShopsDto;
}

describe('endpoints derivados de shops — mapeo de errores de base (US-5)', () => {
  let service: ShopsService;

  beforeEach(() => {
    listShopsMock.mockReset();
    listShopsNearMock.mockReset();
    service = new ShopsService();
  });

  const connectionError = () => {
    const error = new Error("Can't reach database server at `localhost:5433`");
    error.name = 'PrismaClientInitializationError';
    return error;
  };

  describe('getNewShops', () => {
    it('error de conexión → 503 con mensaje amigable', async () => {
      listShopsMock.mockRejectedValue(connectionError());

      expect.assertions(3);
      try {
        await service.getNewShops(rawQuery({ limit: '10', page: '1' }));
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).message).toBe(
          'No se puede conectar con el servicio. Por favor, intenta más tarde.',
        );
      }
    });

    it('cualquier otro error → 500, sin crashear el proceso', async () => {
      listShopsMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await service.getNewShops(rawQuery({ limit: '10', page: '1' }));
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as InternalServerErrorException).getStatus()).toBe(500);
        expect((error as InternalServerErrorException).message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    });
  });

  describe('getNearByShop', () => {
    it('error de conexión → 503 con mensaje amigable', async () => {
      listShopsNearMock.mockRejectedValue(connectionError());

      expect.assertions(3);
      try {
        await service.getNearByShop('40.7128', '-74.0060');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).message).toBe(
          'No se puede conectar con el servicio. Por favor, intenta más tarde.',
        );
      }
    });

    it('cualquier otro error → 500, sin crashear el proceso', async () => {
      listShopsNearMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await service.getNearByShop('40.7128', '-74.0060');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as InternalServerErrorException).getStatus()).toBe(500);
        expect((error as InternalServerErrorException).message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    });

    // Guarda de B-4: `lat`/`lng` no finitos NO deben propagarse como error.
    // La tienda dispara `/near-by-shop/undefined/undefined` en cada carga de
    // `/shops` (useQuery sin `enabled`), así que un 4xx/5xx aquí rompería la
    // página entera. El guard real vive en el repositorio; esto asegura que
    // el servicio no lo estropea al traducir.
    it('lat/lng no finitos: devuelve lo que dé el repositorio, sin lanzar', async () => {
      listShopsNearMock.mockResolvedValue([]);

      await expect(
        service.getNearByShop('undefined', 'undefined'),
      ).resolves.toEqual([]);
      expect(listShopsNearMock).toHaveBeenCalledWith(NaN, NaN);
    });
  });
});
