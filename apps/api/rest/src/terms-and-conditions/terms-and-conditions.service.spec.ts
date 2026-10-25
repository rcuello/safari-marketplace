/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `TermsAndConditionsService` (US-47). Mismo arnés que
 * `tags.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import {
  createTermsAndConditions,
  deleteTermsAndConditions,
  findTermsAndConditionsBySlug,
  listTermsAndConditions,
  RecordNotFoundError,
  setTermsApproval,
  updateTermsAndConditions,
  type TermsAndConditionsRecord,
} from '@safari/db';
import { TermsAndConditionsService } from './terms-and-conditions.service';
import { CreateTermsAndConditionsDto } from './dto/create-terms-and-conditions.dto';
import { GetTermsAndConditionsDto } from './dto/get-terms-and-conditions.dto';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listTermsAndConditions: vi.fn(),
  findTermsAndConditionsBySlug: vi.fn(),
  createTermsAndConditions: vi.fn(),
  updateTermsAndConditions: vi.fn(),
  deleteTermsAndConditions: vi.fn(),
  setTermsApproval: vi.fn(),
}));

const listMock = vi.mocked(listTermsAndConditions);
const findMock = vi.mocked(findTermsAndConditionsBySlug);
const createMock = vi.mocked(createTermsAndConditions);
const updateMock = vi.mocked(updateTermsAndConditions);
const deleteMock = vi.mocked(deleteTermsAndConditions);
const approvalMock = vi.mocked(setTermsApproval);

const NOW = new Date('2026-10-20T00:00:00Z');

function makeRecord(
  overrides: Partial<TermsAndConditionsRecord> = {},
): TermsAndConditionsRecord {
  return {
    id: 10,
    title: 'Privacy Policy',
    slug: 'privacy-policy',
    description: 'x',
    type: 'global',
    issuedBy: 'Super Admin',
    isApproved: true,
    shopId: null,
    userId: null,
    language: 'en',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function query(input: Record<string, unknown>): GetTermsAndConditionsDto {
  return input as unknown as GetTermsAndConditionsDto;
}

const MOCK_KEYS = [
  'id',
  'title',
  'slug',
  'description',
  'type',
  'issued_by',
  'is_approved',
  'language',
  'translated_languages',
];

describe('TermsAndConditionsService', () => {
  let service: TermsAndConditionsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TermsAndConditionsService();
  });

  describe('findAllTermsAndConditions', () => {
    it('proyecta las 9 claves del mock con is_approved entero 1/0', async () => {
      listMock.mockResolvedValue({
        items: [makeRecord(), makeRecord({ id: 11, isApproved: false })],
        total: 2,
      });
      const page = await service.findAllTermsAndConditions(query({}));
      expect(Object.keys(page.data[0])).toEqual(MOCK_KEYS);
      expect(page.data.map((t) => t.is_approved)).toEqual([1, 0]);
    });

    it('traduce la query del shop /terms: type.slug, issued_by e is_approved string', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllTermsAndConditions(
        query({
          searchJoin: 'and',
          limit: '100',
          is_approved: 'true',
          search: 'type.slug:global;issued_by:Super Admin',
        }),
      );
      expect(listMock).toHaveBeenCalledWith({
        shopId: undefined,
        type: 'global',
        issuedBy: 'Super Admin',
        title: undefined,
        isApproved: true,
        page: 1,
        limit: 100,
      });
    });

    it("is_approved='false' filtra pendientes; ausente no filtra", async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllTermsAndConditions(query({ is_approved: 'false' }));
      await service.findAllTermsAndConditions(query({}));
      expect(listMock.mock.calls[0][0].isApproved).toBe(false);
      expect(listMock.mock.calls[1][0].isApproved).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('por slug; inexistente ⇒ 404', async () => {
      findMock.mockResolvedValueOnce(makeRecord());
      expect((await service.findOne('privacy-policy')).id).toBe(10);
      findMock.mockResolvedValueOnce(null);
      await expect(service.findOne('no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('aprobado de entrada, con autor, slug opcional y shop_id coercionado', async () => {
      createMock.mockResolvedValue(makeRecord());
      await service.create(
        {
          title: 'T',
          description: 'd',
          slug: 'mi-slug',
          shop_id: '5',
        } as CreateTermsAndConditionsDto,
        3,
      );
      expect(createMock).toHaveBeenCalledWith({
        title: 'T',
        description: 'd',
        slug: 'mi-slug',
        shopId: 5,
        userId: 3,
        isApproved: true,
      });
    });
  });

  describe('approve / disapprove (V-7)', () => {
    it('persisten y emiten is_approved entero', async () => {
      approvalMock.mockResolvedValueOnce(makeRecord({ isApproved: false }));
      const off = await service.disapproveTermsAndCondition('10');
      expect(approvalMock).toHaveBeenCalledWith(10, false);
      expect(off.is_approved).toBe(0);

      approvalMock.mockResolvedValueOnce(makeRecord({ isApproved: true }));
      expect((await service.approveTermsAndCondition(10)).is_approved).toBe(1);
    });

    it('id inexistente ⇒ 404 (antes 500); id mal formado no toca el driver', async () => {
      approvalMock.mockRejectedValue(
        new RecordNotFoundError('terms_and_conditions', 999),
      );
      await expect(
        service.approveTermsAndCondition(999),
      ).rejects.toBeInstanceOf(NotFoundException);
      approvalMock.mockClear();
      await expect(
        service.approveTermsAndCondition('abc'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(approvalMock).not.toHaveBeenCalled();
    });
  });

  describe('update / remove', () => {
    it('update y remove devuelven la fila; ids mal formados ⇒ 404', async () => {
      updateMock.mockResolvedValue(makeRecord({ title: 'Nuevo' }));
      expect((await service.update(10, { title: 'Nuevo' })).title).toBe(
        'Nuevo',
      );
      deleteMock.mockResolvedValue(makeRecord());
      expect(Object.keys(await service.remove(10))).toEqual(MOCK_KEYS);
      await expect(service.update(-1, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove(Number.NaN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
