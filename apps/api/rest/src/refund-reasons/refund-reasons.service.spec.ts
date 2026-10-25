/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `RefundReasonsService` (US-48). Mismo arnés que
 * `tags.service.spec.ts`.
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import {
  createRefundReason,
  deleteRefundReason,
  findRefundReasonBySlug,
  listRefundReasons,
  updateRefundReason,
  type RefundReasonRecord,
} from '@safari/db';
import { RefundReasonsService } from './refund-reasons.service';
import { GetRefundReasonDto } from './dto/get-refund-reasons.dto';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listRefundReasons: vi.fn(),
  findRefundReasonBySlug: vi.fn(),
  createRefundReason: vi.fn(),
  updateRefundReason: vi.fn(),
  deleteRefundReason: vi.fn(),
}));

const listMock = vi.mocked(listRefundReasons);
const findMock = vi.mocked(findRefundReasonBySlug);
const createMock = vi.mocked(createRefundReason);
const updateMock = vi.mocked(updateRefundReason);
const deleteMock = vi.mocked(deleteRefundReason);

const MOCK_DATE = new Date('2023-11-12T10:58:58.000Z');

function makeRecord(
  overrides: Partial<RefundReasonRecord> = {},
): RefundReasonRecord {
  return {
    id: 3,
    name: 'Damaged Item',
    slug: 'damaged-item',
    language: 'en',
    createdAt: MOCK_DATE,
    updatedAt: MOCK_DATE,
    ...overrides,
  };
}

function query(input: Record<string, unknown>): GetRefundReasonDto {
  return input as unknown as GetRefundReasonDto;
}

describe('RefundReasonsService', () => {
  let service: RefundReasonsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new RefundReasonsService();
  });

  it('proyecta el contrato byte a byte: orden de claves, timestamps y deleted_at null', async () => {
    listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
    const page = await service.findAll(query({}));
    expect(JSON.stringify(page.data[0])).toBe(
      '{"id":3,"name":"Damaged Item","slug":"damaged-item","language":"en",' +
        '"created_at":"2023-11-12T10:58:58.000Z","updated_at":"2023-11-12T10:58:58.000Z",' +
        '"deleted_at":null,"translated_languages":["en"]}',
    );
  });

  it('filtra por el token name e ignora type.slug', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 });
    await service.findAll(
      query({ searchJoin: 'and', search: 'type.slug:x;name:damaged' }),
    );
    expect(listMock).toHaveBeenCalledWith({
      name: 'damaged',
      page: 1,
      limit: 10,
    });
  });

  it('getRefundReason por slug; inexistente ⇒ 404', async () => {
    findMock.mockResolvedValueOnce(makeRecord());
    expect((await service.getRefundReason('damaged-item')).id).toBe(3);
    findMock.mockResolvedValueOnce(null);
    await expect(service.getRefundReason('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create usa name/slug/language del admin', async () => {
    createMock.mockResolvedValue(makeRecord());
    await service.create({
      name: 'Producto defectuoso',
      slug: '',
      language: 'en',
    } as never);
    expect(createMock).toHaveBeenCalledWith({
      name: 'Producto defectuoso',
      slug: '',
      language: 'en',
    });
  });

  it('update y remove devuelven la fila; ids mal formados ⇒ 404 sin tocar el driver', async () => {
    updateMock.mockResolvedValue(makeRecord({ name: 'Nuevo' }));
    expect((await service.update(3, { name: 'Nuevo' })).name).toBe('Nuevo');
    deleteMock.mockResolvedValue(makeRecord());
    expect((await service.remove(3)).id).toBe(3);
    await expect(service.update(0, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(-4)).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
