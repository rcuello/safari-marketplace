/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `OrderStatusesService` (US-57). Mismo arnés que
 * `coupons.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createOrderStatus,
  deleteOrderStatus,
  findOrderStatusBySlug,
  InvalidFieldValueError,
  listOrderStatuses,
  RecordNotFoundError,
  SlugConflictError,
  updateOrderStatus,
  type OrderStatusRecord,
} from '@safari/db';
import {
  CreateOrderStatusDto,
  UpdateOrderStatusDto,
} from './dto/create-order-status.dto';
import { GetOrderStatusesDto } from './dto/get-order-statuses.dto';
import { OrderStatusesService } from './order-statuses.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listOrderStatuses: jest.fn(),
  findOrderStatusBySlug: jest.fn(),
  createOrderStatus: jest.fn(),
  updateOrderStatus: jest.fn(),
  deleteOrderStatus: jest.fn(),
}));

const listMock = jest.mocked(listOrderStatuses);
const findMock = jest.mocked(findOrderStatusBySlug);
const createMock = jest.mocked(createOrderStatus);
const updateMock = jest.mocked(updateOrderStatus);
const deleteMock = jest.mocked(deleteOrderStatus);

function makeRecord(
  overrides: Partial<OrderStatusRecord> = {},
): OrderStatusRecord {
  return {
    id: 7,
    name: 'Delivered',
    slug: 'delivered',
    serial: 11,
    color: '#d87b64',
    language: 'en',
    createdAt: new Date('2021-03-13T15:04:26.000Z'),
    updatedAt: new Date('2021-03-13T15:09:03.000Z'),
    ...overrides,
  };
}

const connectionError = Object.assign(
  new Error('Invalid `prisma.orderStatus.findMany()` invocation'),
  {
    name: 'PrismaClientKnownRequestError',
    code: 'ECONNREFUSED',
  },
);

describe('OrderStatusesService', () => {
  let service: OrderStatusesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new OrderStatusesService();
  });

  describe('findAll', () => {
    it('proyecta las 9 claves en el orden del mock, con translated_languages constante', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const page = await service.findAll({} as GetOrderStatusesDto);
      expect(Object.keys(page.data[0])).toEqual([
        'id',
        'name',
        'slug',
        'serial',
        'color',
        'created_at',
        'updated_at',
        'language',
        'translated_languages',
      ]);
      expect(page.data[0].translated_languages).toEqual(['en']);
      expect(listMock).toHaveBeenCalledWith({
        name: undefined,
        page: 1,
        limit: 30,
      });
      expect(page.first_page_url).toContain(
        '/order-status?search=undefined&limit=30&page=1',
      );
    });

    it('per_page sale como string si limit llega de la query (sin transform)', async () => {
      listMock.mockResolvedValue({ items: [], total: 10 });
      const page = await service.findAll({
        limit: '5',
        page: '2',
      } as unknown as GetOrderStatusesDto);
      expect(page.per_page).toBe('5');
      expect(listMock).toHaveBeenCalledWith({
        name: undefined,
        page: 2,
        limit: 5,
      });
    });

    it('search=name:<texto> y texto libre filtran por nombre; slug: se ignora', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAll({ search: 'name:Order' } as GetOrderStatusesDto);
      await service.findAll({ search: 'Order' } as GetOrderStatusesDto);
      await service.findAll({
        search: 'slug:delivered',
      } as GetOrderStatusesDto);
      expect(listMock.mock.calls.map(([input]) => input?.name)).toEqual([
        'Order',
        'Order',
        undefined,
      ]);
    });

    it('orderBy del enum se traduce; sortedBy por defecto asc; desconocido se ignora', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAll({
        orderBy: 'UPDATED_AT',
        sortedBy: 'desc',
      } as GetOrderStatusesDto);
      await service.findAll({ orderBy: 'NAME' } as GetOrderStatusesDto);
      await service.findAll({
        orderBy: 'COLOR',
      } as unknown as GetOrderStatusesDto);
      expect(listMock.mock.calls[0][0]).toMatchObject({
        orderBy: 'updatedAt',
        sortedBy: 'desc',
      });
      expect(listMock.mock.calls[1][0]).toMatchObject({
        orderBy: 'name',
        sortedBy: 'asc',
      });
      expect(listMock.mock.calls[2][0]).not.toHaveProperty('orderBy');
    });

    it('base caída ⇒ 503', async () => {
      listMock.mockRejectedValue(connectionError);
      await expect(
        service.findAll({} as GetOrderStatusesDto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('findOne', () => {
    it('por slug; inexistente ⇒ 404 (V-3)', async () => {
      findMock.mockResolvedValueOnce(makeRecord()).mockResolvedValueOnce(null);
      expect((await service.findOne('delivered')).serial).toBe(11);
      await expect(service.findOne('no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('escrituras', () => {
    it('create proyecta el DTO y coerciona serial a número', async () => {
      createMock.mockResolvedValue(
        makeRecord({ id: 11, slug: 'ca-3-estado', serial: 12 }),
      );
      const dto = {
        name: 'CA-3 Estado',
        color: '#112233',
        serial: '12',
        language: 'en',
      };
      const created = await service.create(
        dto as unknown as CreateOrderStatusDto,
      );
      expect(createMock).toHaveBeenCalledWith({
        name: 'CA-3 Estado',
        color: '#112233',
        serial: 12,
        language: 'en',
      });
      expect(created.slug).toBe('ca-3-estado');
    });

    it('serial repetido ⇒ 409; CHECK ⇒ 400', async () => {
      createMock.mockRejectedValueOnce(
        new SlugConflictError('order_statuses', 'serial'),
      );
      createMock.mockRejectedValueOnce(
        new InvalidFieldValueError(
          'order_statuses',
          'color',
          'rojo',
          'order_statuses_color_check',
        ),
      );
      const dto = {
        name: 'x',
        color: '#112233',
        serial: 1,
      } as CreateOrderStatusDto;
      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.create(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('update pasa solo las claves presentes y devuelve un estado (V-1)', async () => {
      updateMock.mockResolvedValue(
        makeRecord({ id: 1, name: 'CA-3 Editado', slug: 'ca-3-editado' }),
      );
      const updated = await service.update(1, {
        name: 'CA-3 Editado',
      } as UpdateOrderStatusDto);
      expect(updateMock).toHaveBeenCalledWith(1, { name: 'CA-3 Editado' });
      expect(updated).toHaveProperty('serial');
      expect(updated).not.toHaveProperty('tracking_number');
    });

    it('update/remove de un id inexistente ⇒ 404; id mal formado ⇒ 404 sin tocar la base', async () => {
      updateMock.mockRejectedValue(
        new RecordNotFoundError('order_statuses', 999),
      );
      deleteMock.mockRejectedValue(
        new RecordNotFoundError('order_statuses', 999),
      );
      await expect(
        service.update(999, {} as UpdateOrderStatusDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      for (const id of [Number.NaN, 1e21, 0]) {
        await expect(
          service.update(id, {} as UpdateOrderStatusDto),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.remove(id)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });

    it('remove devuelve el snapshot borrado (V-2)', async () => {
      deleteMock.mockResolvedValue(makeRecord());
      expect(await service.remove(7)).toMatchObject({
        id: 7,
        slug: 'delivered',
      });
    });
  });
});
