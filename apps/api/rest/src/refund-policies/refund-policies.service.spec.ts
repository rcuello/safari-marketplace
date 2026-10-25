/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `RefundPoliciesService` (US-48). Mismo arnés que
 * `tags.service.spec.ts`: solo se mockea el acceso a datos; las clases de
 * error de dominio y `toWriteHttpException` son reales.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createRefundPolicy,
  deleteRefundPolicy,
  findRefundPolicyBySlug,
  InvalidFieldValueError,
  listRefundPolicies,
  RecordNotFoundError,
  updateRefundPolicy,
  type RefundPolicyRecord,
} from '@safari/db';
import { RefundPoliciesService } from './refund-policies.service';
import { CreateRefundPolicyDto } from './dto/create-refund-policy.dto';
import { GetRefundPolicyDto } from './dto/get-refund-policies.dto';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listRefundPolicies: vi.fn(),
  findRefundPolicyBySlug: vi.fn(),
  createRefundPolicy: vi.fn(),
  updateRefundPolicy: vi.fn(),
  deleteRefundPolicy: vi.fn(),
}));

const listMock = vi.mocked(listRefundPolicies);
const findMock = vi.mocked(findRefundPolicyBySlug);
const createMock = vi.mocked(createRefundPolicy);
const updateMock = vi.mocked(updateRefundPolicy);
const deleteMock = vi.mocked(deleteRefundPolicy);

const NOW = new Date('2026-10-21T00:00:00Z');

function makeRecord(
  overrides: Partial<RefundPolicyRecord> = {},
): RefundPolicyRecord {
  return {
    id: 2,
    title: 'Customer Return Policy',
    slug: 'customer-return-policy',
    description: 'x',
    target: 'customer',
    status: 'approved',
    shopId: null,
    language: 'en',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function query(input: Record<string, unknown>): GetRefundPolicyDto {
  return input as unknown as GetRefundPolicyDto;
}

const MOCK_KEYS = [
  'id',
  'title',
  'slug',
  'target',
  'status',
  'description',
  'language',
  'translated_languages',
];

describe('RefundPoliciesService', () => {
  let service: RefundPoliciesService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new RefundPoliciesService();
  });

  describe('findAllRefundPolicies', () => {
    it('proyecta las 8 claves del mock, sin shop_id ni timestamps', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const page = await service.findAllRefundPolicies(query({}));
      expect(Object.keys(page.data[0])).toEqual(MOCK_KEYS);
    });

    it('traduce la query del shop a target y status con AND (V-1)', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.findAllRefundPolicies(
        query({
          searchJoin: 'and',
          limit: '10',
          search: 'target:customer;status:approved',
        }),
      );
      expect(listMock).toHaveBeenCalledWith({
        target: 'customer',
        status: 'approved',
        title: undefined,
        shopId: undefined,
        page: 1,
        limit: 10,
      });
    });

    it('conserva per_page string y la url base del mock', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const page = await service.findAllRefundPolicies(query({ limit: '10' }));
      expect(page.per_page).toBe('10');
      expect(page.first_page_url).toBe(
        'http://localhost:5000/api/refund-policies?search=undefined&limit=10&page=1',
      );
    });

    it('shop_id mal formado no consulta y devuelve página vacía', async () => {
      const page = await service.findAllRefundPolicies(
        query({ search: 'shop_id:abc' }),
      );
      expect(listMock).not.toHaveBeenCalled();
      expect(page.total).toBe(0);
    });
  });

  describe('getRefundPolicy', () => {
    it('por slug; inexistente ⇒ 404 (V-3)', async () => {
      findMock.mockResolvedValueOnce(makeRecord());
      expect(
        Object.keys(await service.getRefundPolicy('customer-return-policy')),
      ).toEqual(MOCK_KEYS);
      findMock.mockResolvedValueOnce(null);
      await expect(service.getRefundPolicy('no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create / update / remove', () => {
    it('create pasa el payload del admin campo a campo', async () => {
      createMock.mockResolvedValue(makeRecord());
      await service.create({
        title: 'Nueva',
        slug: 'nueva',
        target: 'vendor',
        status: 'approved',
        description: 'd',
        language: 'en',
      } as CreateRefundPolicyDto);
      expect(createMock).toHaveBeenCalledWith({
        title: 'Nueva',
        target: 'vendor',
        status: 'approved',
        slug: 'nueva',
        description: 'd',
        language: 'en',
      });
    });

    it('target fuera del CHECK ⇒ 400', async () => {
      createMock.mockRejectedValue(
        new InvalidFieldValueError(
          'refund_policies',
          'target',
          'admin',
          'refund_policies_target_check',
        ),
      );
      await expect(
        service.create({
          title: 'x',
          target: 'admin',
        } as CreateRefundPolicyDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update ignora el slug del body y devuelve la fila', async () => {
      updateMock.mockResolvedValue(makeRecord({ status: 'pending' }));
      const out = await service.update(2, {
        status: 'pending',
        slug: 'otro',
      } as never);
      expect(updateMock).toHaveBeenCalledWith(2, { status: 'pending' });
      expect(out).toMatchObject({ status: 'pending' });
    });

    it('remove devuelve la fila; ids mal formados o inexistentes ⇒ 404', async () => {
      deleteMock.mockResolvedValueOnce(makeRecord());
      expect(Object.keys(await service.remove(2))).toEqual(MOCK_KEYS);
      await expect(service.remove(Number.NaN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      deleteMock.mockRejectedValueOnce(
        new RecordNotFoundError('refund_policies', 9),
      );
      await expect(service.remove(9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
