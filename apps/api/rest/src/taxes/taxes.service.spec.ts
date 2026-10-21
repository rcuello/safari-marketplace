/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `TaxesService` (US-49). Mismo arnés que
 * `tags.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createTax,
  deleteTax,
  findTaxById,
  InvalidFieldValueError,
  listTaxes,
  updateTax,
  type TaxRecord,
} from '@safari/db';
import { TaxesService } from './taxes.service';
import { CreateTaxDto } from './dto/create-tax.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listTaxes: jest.fn(),
  findTaxById: jest.fn(),
  createTax: jest.fn(),
  updateTax: jest.fn(),
  deleteTax: jest.fn(),
}));

const listMock = jest.mocked(listTaxes);
const findMock = jest.mocked(findTaxById);
const createMock = jest.mocked(createTax);
const updateMock = jest.mocked(updateTax);
const deleteMock = jest.mocked(deleteTax);

function makeRecord(overrides: Partial<TaxRecord> = {}): TaxRecord {
  return {
    id: 1,
    name: 'Global',
    rate: 2,
    isGlobal: true,
    country: null,
    state: null,
    zip: null,
    city: null,
    priority: null,
    onShipping: true,
    createdAt: new Date('2021-03-25T13:26:57.000Z'),
    updatedAt: new Date('2021-03-25T16:07:18.000Z'),
    ...overrides,
  };
}

describe('TaxesService', () => {
  let service: TaxesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new TaxesService();
  });

  it('proyecta byte a byte la fila del mock, con su orden peculiar de claves', async () => {
    listMock.mockResolvedValue([makeRecord()]);
    expect(JSON.stringify(await service.findAll({}))).toBe(
      '[{"id":1,"country":null,"state":null,"zip":null,"city":null,"rate":2,"name":"Global",' +
        '"is_global":true,"priority":null,"on_shipping":true,' +
        '"created_at":"2021-03-25T13:26:57.000Z","updated_at":"2021-03-25T16:07:18.000Z"}]',
    );
  });

  it('devuelve un array sin paginar y filtra por search=name:X (V-1)', async () => {
    listMock.mockResolvedValue([]);
    await service.findAll({ search: 'name:IVA' });
    await service.findAll({});
    expect(listMock.mock.calls).toEqual([[{ name: 'IVA' }], [{ name: undefined }]]);
  });

  it('findOne: 404 si no existe o el id es inválido, sin tocar el driver en el segundo caso', async () => {
    findMock.mockResolvedValueOnce(null);
    await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(Number.NaN)).rejects.toBeInstanceOf(NotFoundException);
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it('create coerciona rate y booleanos y devuelve la fila', async () => {
    createMock.mockResolvedValue(makeRecord({ id: 2, name: 'IVA', rate: 19 }));
    const out = await service.create({
      name: 'IVA',
      rate: '19',
      is_global: 'true',
      on_shipping: false,
    } as unknown as CreateTaxDto);
    expect(createMock).toHaveBeenCalledWith({
      name: 'IVA',
      rate: 19,
      isGlobal: true,
      onShipping: false,
    });
    expect(out).toMatchObject({ id: 2, rate: 19 });
  });

  it('rate no numérico ⇒ 400 (el repositorio rechaza NaN)', async () => {
    createMock.mockRejectedValue(
      new InvalidFieldValueError('taxes', 'rate', Number.NaN, 'taxes_rate_check'),
    );
    await expect(
      service.create({ name: 'x', rate: 'abc' } as unknown as CreateTaxDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createMock.mock.calls[0][0].rate).toBeNaN();
  });

  it('update y remove devuelven la fila', async () => {
    updateMock.mockResolvedValue(makeRecord({ rate: 5 }));
    expect((await service.update(1, { rate: 5 })).rate).toBe(5);
    expect(updateMock).toHaveBeenCalledWith(1, { rate: 5 });
    deleteMock.mockResolvedValue(makeRecord());
    expect((await service.remove(1)).id).toBe(1);
    await expect(service.remove(0)).rejects.toBeInstanceOf(NotFoundException);
  });
});
