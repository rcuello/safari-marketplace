/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `ShippingsService` (US-49). Mismo arnés que
 * `tags.service.spec.ts`.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createShipping,
  deleteShipping,
  findShippingById,
  InvalidFieldValueError,
  listShippings,
  RecordNotFoundError,
  updateShipping,
  type ShippingRecord,
} from '@safari/db';
import { ShippingsService } from './shippings.service';
import { CreateShippingDto } from './dto/create-shipping.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listShippings: jest.fn(),
  findShippingById: jest.fn(),
  createShipping: jest.fn(),
  updateShipping: jest.fn(),
  deleteShipping: jest.fn(),
}));

const listMock = jest.mocked(listShippings);
const findMock = jest.mocked(findShippingById);
const createMock = jest.mocked(createShipping);
const updateMock = jest.mocked(updateShipping);
const deleteMock = jest.mocked(deleteShipping);

function makeRecord(overrides: Partial<ShippingRecord> = {}): ShippingRecord {
  return {
    id: 1,
    name: 'Global',
    amount: 50,
    isGlobal: true,
    type: 'fixed',
    createdAt: new Date('2021-03-25T13:27:49.000Z'),
    updatedAt: new Date('2021-03-25T13:27:49.000Z'),
    ...overrides,
  };
}

describe('ShippingsService', () => {
  let service: ShippingsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ShippingsService();
  });

  it('proyecta byte a byte la fila del mock', async () => {
    listMock.mockResolvedValue([makeRecord()]);
    expect(JSON.stringify(await service.getShippings({}))).toBe(
      '[{"id":1,"name":"Global","amount":50,"is_global":true,"type":"fixed",' +
        '"created_at":"2021-03-25T13:27:49.000Z","updated_at":"2021-03-25T13:27:49.000Z"}]',
    );
  });

  it('filtra por search=name:X', async () => {
    listMock.mockResolvedValue([]);
    await service.getShippings({ search: 'name:Express' });
    expect(listMock).toHaveBeenCalledWith({ name: 'Express' });
  });

  it('create coerciona amount; type inválido ⇒ 400', async () => {
    createMock.mockResolvedValueOnce(makeRecord({ id: 2 }));
    await service.create({ name: 'E', amount: '10', type: 'fixed' } as unknown as CreateShippingDto);
    expect(createMock).toHaveBeenCalledWith({ name: 'E', amount: 10, type: 'fixed' });

    createMock.mockRejectedValueOnce(
      new InvalidFieldValueError('shippings', 'type', 'gratis', 'shippings_type_check'),
    );
    await expect(
      service.create({ name: 'E', amount: 1, type: 'gratis' } as unknown as CreateShippingDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findOne / update / remove: 404 en inexistente o id inválido', async () => {
    findMock.mockResolvedValueOnce(null);
    await expect(service.findOne(9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(-1, {})).rejects.toBeInstanceOf(NotFoundException);
    deleteMock.mockRejectedValueOnce(new RecordNotFoundError('shippings', 9));
    await expect(service.remove(9)).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
