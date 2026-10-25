/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest;
 * se limita a este archivo para no tocar la config del build (calco
 * `categories.service.spec.ts:1-6`).
 */
/**
 * Tests unitarios de `BecomeSellerService` (US-44/US-45): el envoltorio
 * (D-2) y la delegación del `POST` (D-4). `@safari/db` se mockea completo —
 * el barrel es seguro de cargar sin `DATABASE_URL` (cliente lazy vía
 * Proxy), mismo arnés que `categories.service.spec.ts:66-82`.
 *
 * No hay clases de error de dominio que probar aquí (D-6): el repositorio
 * de `become_seller` nunca lanza un error de dominio, solo devuelve
 * `| null` (D-1) — la única guarda de fila ausente es
 * `InternalServerErrorException`.
 *
 * Red de regresión de CA-3 (D-10, US-45): `AssertSameKeys` deriva las
 * claves del JSON real (`@db/become-seller.json`, mapeado en
 * `moduleNameMapper`) con `keyof typeof`, así que un renombre o borrado de
 * clave rompe la compilación en la dirección que corresponda — sin
 * `satisfies`. No es que el compilador instalado hoy carezca de él (el
 * binario resuelto es `typescript@4.9.5`, que sí lo trae); es que
 * `apps/api/rest/package.json` declara el rango `^4.7.4`, que permite
 * instalar cualquier `4.7.x` sin `satisfies` (llegó en 4.9), así que la red
 * no puede depender de una versión más nueva que la que el rango declarado
 * garantiza. Desde US-88 la suite corre en Vitest con SWC, que transpila
 * sin comprobar tipos: esta red la dispara `npx tsc --noEmit -p
 * tsconfig.json` (que incluye los specs), no `vitest run`.
 */
import { getBecomeSeller, updateBecomeSeller } from '@safari/db';
import type { BecomeSellerRecord } from '@safari/db';
import { InternalServerErrorException } from '@nestjs/common';
import becomeSellerJson from '#db/become-seller.json' with { type: 'json' };
import { BecomeSellerService } from './become-seller.service.js';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto.js';
import {
  BecomeSeller,
  BecomeSellerEnvelope,
  BecomeSellerOptions,
} from './entities/become-seller.entity.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  getBecomeSeller: vi.fn(),
  updateBecomeSeller: vi.fn(),
}));

const getBecomeSellerMock = vi.mocked(getBecomeSeller);
const updateBecomeSellerMock = vi.mocked(updateBecomeSeller);

const CREATED_AT = new Date('2024-06-06T10:30:48.000Z');
const UPDATED_AT = new Date('2024-06-12T11:31:46.000Z');

function makeRecord(
  overrides: Partial<BecomeSellerRecord> = {},
): BecomeSellerRecord {
  return {
    id: 1,
    pageOptions: { sellingStepsTitle: 'Vende con nosotros' },
    commissions: [{ level: 'bronze' }, { level: 'silver' }],
    language: 'en',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

/**
 * Fixture de `create()` construida desde el JSON real (D-11): compila sin
 * cast — `page_options` es directamente el objeto interno de 24 claves
 * (`json.page_options.page_options`), no el envoltorio.
 */
function realCreateDto(): CreateBecomeSellerDto {
  return {
    language: becomeSellerJson.page_options.language,
    page_options: becomeSellerJson.page_options.page_options,
    commissions: becomeSellerJson.commissions,
  };
}

// ---------------------------------------------------------------------------
// Red de regresión CA-3 (D-4/D-10): drift de claves del contrato interno.
// ---------------------------------------------------------------------------
type KeyDrift<T, K extends string> = Exclude<keyof T, K> | Exclude<K, keyof T>;
type AssertSameKeys<T, K extends string> = [KeyDrift<T, K>] extends [never]
  ? true
  : KeyDrift<T, K>;

const _topLevelKeys: AssertSameKeys<
  BecomeSeller,
  keyof typeof becomeSellerJson
> = true;
const _envelopeKeys: AssertSameKeys<
  BecomeSellerEnvelope,
  keyof typeof becomeSellerJson.page_options
> = true;
const _optionKeys: AssertSameKeys<
  BecomeSellerOptions,
  keyof typeof becomeSellerJson.page_options.page_options
> = true;
const _dtoKeys: AssertSameKeys<
  CreateBecomeSellerDto,
  'language' | 'page_options' | 'commissions'
> = true;

describe('BecomeSellerService — red de tipos del contrato interno (CA-3 / D-10)', () => {
  it('las 24 claves del objeto interno siguen presentes en el dato real, en el orden declarado', () => {
    expect(
      Object.keys(becomeSellerJson.page_options.page_options),
    ).toHaveLength(24);
    expect(Object.keys(becomeSellerJson.page_options.page_options)).toEqual([
      'defaultCommissionRate',
      'defaultCommissionDetails',
      'banner',
      'sellingStepsTitle',
      'sellingStepsDescription',
      'sellingStepsItem',
      'userStoryTitle',
      'userStoryDescription',
      'purposeTitle',
      'purposeDescription',
      'purposeItems',
      'commissionTitle',
      'commissionDescription',
      'isMultiCommissionRate',
      'dashboard',
      'guidelineTitle',
      'guidelineDescription',
      'guidelineItems',
      'faqTitle',
      'faqDescription',
      'faqItems',
      'contact',
      'sellerOpportunity',
      'userStories',
    ]);
  });

  it('las aserciones de tipo `AssertSameKeys` compilan en verde (ver `_topLevelKeys`/`_envelopeKeys`/`_optionKeys`/`_dtoKeys` arriba)', () => {
    expect([_topLevelKeys, _envelopeKeys, _optionKeys, _dtoKeys]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('BecomeSellerService.findAll (US-44/US-45)', () => {
  let service: BecomeSellerService;

  beforeEach(() => {
    getBecomeSellerMock.mockReset();
    service = new BecomeSellerService();
  });

  it('recompone el envoltorio (D-2): 2 claves top-level, 5 del envoltorio, `page_options.page_options` idéntico por referencia', async () => {
    const record = makeRecord();
    getBecomeSellerMock.mockResolvedValue(record);

    const result = await service.findAll();

    expect(Object.keys(result)).toEqual(['page_options', 'commissions']);
    expect(Object.keys(result.page_options)).toEqual([
      'id',
      'page_options',
      'language',
      'created_at',
      'updated_at',
    ]);
    expect(result.page_options.page_options).toBe(record.pageOptions);
    expect(result.commissions).toBe(record.commissions);
  });

  it('`getBecomeSeller` resolviendo `null` (base no sembrada) → 500', async () => {
    getBecomeSellerMock.mockResolvedValue(null);

    expect.assertions(2);
    try {
      await service.findAll();
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('BecomeSellerService.create (US-44, D-4)', () => {
  let service: BecomeSellerService;

  beforeEach(() => {
    updateBecomeSellerMock.mockReset();
    service = new BecomeSellerService();
  });

  it('delega en `updateBecomeSeller` con las 3 claves tal cual y devuelve el mismo envoltorio que `findAll()`', async () => {
    const record = makeRecord();
    updateBecomeSellerMock.mockResolvedValue(record);
    const dto = realCreateDto();

    const result = await service.create(dto);

    expect(updateBecomeSellerMock).toHaveBeenCalledWith({
      pageOptions: dto.page_options,
      commissions: dto.commissions,
      language: dto.language,
    });
    expect(Object.keys(result)).toEqual(['page_options', 'commissions']);
    expect(Object.keys(result.page_options)).toEqual([
      'id',
      'page_options',
      'language',
      'created_at',
      'updated_at',
    ]);
  });

  it('`updateBecomeSeller` resolviendo `null` (base no sembrada) → 500', async () => {
    updateBecomeSellerMock.mockResolvedValue(null);
    const dto = realCreateDto();

    expect.assertions(2);
    try {
      await service.create(dto);
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });

  it('sin `language` en el body, el input a `updateBecomeSeller` NO lleva esa clave (spread condicional, no `undefined` explícito)', async () => {
    updateBecomeSellerMock.mockResolvedValue(makeRecord());
    const dto = realCreateDto();
    delete dto.language;

    await service.create(dto);

    const calledWith = updateBecomeSellerMock.mock.calls[0][0];
    expect('language' in calledWith).toBe(false);
    expect(calledWith).toEqual({
      pageOptions: dto.page_options,
      commissions: dto.commissions,
    });
  });

  /**
   * Corrección de regresión: la guarda de escritura pasó a ser la MISMA
   * condición que la de lectura (`_isBecomeSellerOptions`/
   * `_isCommissionList`, un objeto exacto / un array exacto), no la más
   * laxa "cualquier objeto u array" que tenía antes. Un body real llega
   * como JSON parseado sin garantías de tipo en compilación (la ruta es
   * `@Public()` y `ValidationPipe` corre sin opciones), así que la fixture
   * de abajo lo simula con `JSON.parse(JSON.stringify(...))` — sin ningún
   * cast de tipos — en vez de forzar el tipo del DTO.
   */
  function malformedDto(patch: Record<string, unknown>): CreateBecomeSellerDto {
    const raw = JSON.parse(JSON.stringify({ ...realCreateDto(), ...patch }));
    return raw;
  }

  it('`commissions` como objeto (no array) NO se reenvía a `updateBecomeSeller` — antes provocaba un 500 permanente en la siguiente lectura', async () => {
    updateBecomeSellerMock.mockResolvedValue(makeRecord());
    const dto = malformedDto({ commissions: { a: 1 } });

    await service.create(dto);

    const calledWith = updateBecomeSellerMock.mock.calls[0][0];
    expect('commissions' in calledWith).toBe(false);
    expect(calledWith).toEqual({
      pageOptions: dto.page_options,
      language: dto.language,
    });
  });

  it('`page_options` como array (no objeto) NO se reenvía a `updateBecomeSeller`', async () => {
    updateBecomeSellerMock.mockResolvedValue(makeRecord());
    const dto = malformedDto({ page_options: [1, 2, 3] });

    await service.create(dto);

    const calledWith = updateBecomeSellerMock.mock.calls[0][0];
    expect('pageOptions' in calledWith).toBe(false);
    expect(calledWith).toEqual({
      commissions: dto.commissions,
      language: dto.language,
    });
  });
});
