/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `AttributesService` (US-50). Mismo arnés que
 * `tags.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createAttribute,
  deleteAttribute,
  findAttributeByIdOrSlug,
  InvalidReferenceError,
  listAttributes,
  RecordNotFoundError,
  updateAttribute,
  type AttributeRecord,
} from '@safari/db';
import { AttributesService } from './attributes.service.js';
import { CreateAttributeDto } from './dto/create-attribute.dto.js';
import { UpdateAttributeDto } from './dto/update-attribute.dto.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listAttributes: vi.fn(),
  findAttributeByIdOrSlug: vi.fn(),
  createAttribute: vi.fn(),
  updateAttribute: vi.fn(),
  deleteAttribute: vi.fn(),
}));

const listMock = vi.mocked(listAttributes);
const findMock = vi.mocked(findAttributeByIdOrSlug);
const createMock = vi.mocked(createAttribute);
const updateMock = vi.mocked(updateAttribute);
const deleteMock = vi.mocked(deleteAttribute);

const NOW = new Date('2026-10-21T00:00:00Z');

function makeRecord(overrides: Partial<AttributeRecord> = {}): AttributeRecord {
  return {
    id: 10,
    name: 'Color',
    slug: 'color-OMG',
    shopId: 11,
    language: 'en',
    createdAt: NOW,
    updatedAt: NOW,
    values: [
      {
        id: 32,
        attributeId: 10,
        value: 'Black',
        slug: 'black-3',
        meta: '#000',
        language: 'en',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    ...overrides,
  };
}

describe('AttributesService', () => {
  let service: AttributesService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AttributesService();
  });

  it('proyecta byte a byte la forma del mock en los dos niveles, sin timestamps', async () => {
    listMock.mockResolvedValue([makeRecord()]);
    expect(JSON.stringify(await service.findAll({}))).toBe(
      '[{"id":10,"name":"Color","shop_id":11,"language":"en","translated_languages":["en"],' +
        '"slug":"color-OMG","type":{"id":null,"name":null,"slug":null,"logo":null},' +
        '"values":[{"id":32,"value":"Black","attribute_id":10,"slug":"black-3","meta":"#000",' +
        '"language":"en","translated_languages":["en"]}]}]',
    );
  });

  it('filtra por shop_id desde search o desde la query, e ignora type.slug (V-1)', async () => {
    listMock.mockResolvedValue([]);
    await service.findAll({ search: 'type.slug:x;name:col;shop_id:11' });
    await service.findAll({ shop_id: '7' as unknown as number });
    expect(listMock.mock.calls).toEqual([
      [{ shopId: 11, name: 'col' }],
      [{ shopId: 7, name: undefined }],
    ]);
  });

  it('shop_id mal formado devuelve [] sin consultar', async () => {
    expect(await service.findAll({ search: 'shop_id:abc' })).toEqual([]);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('findOne delega id o slug; inexistente ⇒ 404 (V-2)', async () => {
    findMock.mockResolvedValueOnce(makeRecord());
    expect((await service.findOne('color-OMG')).id).toBe(10);
    findMock.mockResolvedValueOnce(null);
    await expect(service.findOne('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create coerciona shop_id y pasa los valores sin id', async () => {
    createMock.mockResolvedValue(makeRecord());
    await service.create({
      name: 'Color',
      shop_id: '11',
      language: 'en',
      values: [{ value: 'Black', meta: '#000', language: 'en' }],
    } as unknown as CreateAttributeDto);
    expect(createMock).toHaveBeenCalledWith({
      name: 'Color',
      shopId: 11,
      language: 'en',
      values: [{ id: null, value: 'Black', meta: '#000', language: 'en' }],
    });
  });

  it('tienda inexistente ⇒ 400', async () => {
    createMock.mockRejectedValue(
      new InvalidReferenceError('attributes', 'shop_id', 999),
    );
    await expect(
      service.create({
        name: 'X',
        shop_id: '999',
        values: [],
      } as unknown as CreateAttributeDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: el id null del admin pasa como valor nuevo; ignora shop_id y slug', async () => {
    updateMock.mockResolvedValue(makeRecord());
    await service.update(10, {
      name: 'Color',
      shop_id: '11',
      slug: 'otro',
      values: [
        { id: 32, value: 'Black' },
        { id: null, value: 'Blue' },
      ],
    } as unknown as UpdateAttributeDto);
    expect(updateMock).toHaveBeenCalledWith(10, {
      name: 'Color',
      values: [
        { id: 32, value: 'Black' },
        { id: null, value: 'Blue' },
      ],
    });
  });

  it('remove devuelve el atributo con sus valores; ids inválidos o inexistentes ⇒ 404', async () => {
    deleteMock.mockResolvedValueOnce(makeRecord());
    expect((await service.remove(10)).values).toHaveLength(1);
    await expect(service.remove(Number.NaN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    deleteMock.mockRejectedValueOnce(new RecordNotFoundError('attributes', 99));
    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});
