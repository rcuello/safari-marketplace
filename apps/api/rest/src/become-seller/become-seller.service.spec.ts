/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build (calco
 * `categories.service.spec.ts:1-6`).
 */
/**
 * Tests unitarios de `BecomeSellerService` (US-44): el envoltorio (D-2) y
 * la delegación del `POST` (D-4). `@safari/db` se mockea completo — el
 * barrel es seguro de cargar sin `DATABASE_URL` (cliente lazy vía Proxy),
 * mismo arnés que `categories.service.spec.ts:66-82`.
 *
 * No hay clases de error de dominio que probar aquí (D-6): el repositorio
 * de `become_seller` nunca lanza un error de dominio, solo devuelve
 * `| null` (D-1) — la única guarda es `InternalServerErrorException`
 * cuando la fila no está sembrada.
 */
import { getBecomeSeller, updateBecomeSeller } from '@safari/db';
import type { BecomeSellerRecord } from '@safari/db';
import { InternalServerErrorException } from '@nestjs/common';
import { BecomeSellerService } from './become-seller.service';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  getBecomeSeller: jest.fn(),
  updateBecomeSeller: jest.fn(),
}));

const getBecomeSellerMock = jest.mocked(getBecomeSeller);
const updateBecomeSellerMock = jest.mocked(updateBecomeSeller);

const CREATED_AT = new Date('2024-06-06T10:30:48.000Z');
const UPDATED_AT = new Date('2024-06-12T11:31:46.000Z');

function makeRecord(overrides: Partial<BecomeSellerRecord> = {}): BecomeSellerRecord {
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
 * `ValidationPipe` corre sin `transform` (`main.ts:9`); este spec ejercita
 * el servicio directamente, así que construye el DTO a mano — mismo
 * cast-precedente que `categories.service.spec.ts:178-182`.
 */
function createDto(
  input: Record<string, unknown>,
): CreateBecomeSellerDto {
  return input as unknown as CreateBecomeSellerDto;
}

describe('BecomeSellerService.findAll (US-44)', () => {
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
    expect(Object.keys((result as never as { page_options: object }).page_options)).toEqual([
      'id',
      'page_options',
      'language',
      'created_at',
      'updated_at',
    ]);
    const inner = (result as never as { page_options: { page_options: unknown } })
      .page_options.page_options;
    expect(inner).toBe(record.pageOptions);
    expect((result as never as { commissions: unknown }).commissions).toBe(
      record.commissions,
    );
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

    const result = await service.create(
      createDto({
        language: 'es',
        page_options: { sellingStepsTitle: 'Vende con nosotros' },
        commissions: [{ level: 'bronze' }],
      }),
    );

    expect(updateBecomeSellerMock).toHaveBeenCalledWith({
      pageOptions: { sellingStepsTitle: 'Vende con nosotros' },
      commissions: [{ level: 'bronze' }],
      language: 'es',
    });
    expect(Object.keys(result)).toEqual(['page_options', 'commissions']);
    expect(Object.keys((result as never as { page_options: object }).page_options)).toEqual([
      'id',
      'page_options',
      'language',
      'created_at',
      'updated_at',
    ]);
  });

  it('`updateBecomeSeller` resolviendo `null` (base no sembrada) → 500', async () => {
    updateBecomeSellerMock.mockResolvedValue(null);

    expect.assertions(2);
    try {
      await service.create(
        createDto({
          page_options: { sellingStepsTitle: 'x' },
          commissions: [],
        }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });

  it('sin `language` en el body, el input a `updateBecomeSeller` NO lleva esa clave (spread condicional, no `undefined` explícito)', async () => {
    updateBecomeSellerMock.mockResolvedValue(makeRecord());

    await service.create(
      createDto({
        page_options: { sellingStepsTitle: 'x' },
        commissions: [{ level: 'gold' }],
      }),
    );

    const calledWith = updateBecomeSellerMock.mock.calls[0][0];
    expect('language' in calledWith).toBe(false);
    expect(calledWith).toEqual({
      pageOptions: { sellingStepsTitle: 'x' },
      commissions: [{ level: 'gold' }],
    });
  });
});
