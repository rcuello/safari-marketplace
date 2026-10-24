/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `AbusiveReportService` (US-54). Solo se mockea el
 * acceso a datos.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  createAbusiveReport,
  deleteAbusiveReport,
  findAbusiveReportById,
  InvalidFieldValueError,
  listAbusiveReports,
  RecordNotFoundError,
  rejectAbusiveReports,
  SlugConflictError,
  updateAbusiveReport,
  type AbusiveReportDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { AbusiveReportService } from './reports.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listAbusiveReports: jest.fn(),
  findAbusiveReportById: jest.fn(),
  createAbusiveReport: jest.fn(),
  updateAbusiveReport: jest.fn(),
  deleteAbusiveReport: jest.fn(),
  rejectAbusiveReports: jest.fn(),
}));

const listMock = jest.mocked(listAbusiveReports);
const findMock = jest.mocked(findAbusiveReportById);
const createMock = jest.mocked(createAbusiveReport);
const updateMock = jest.mocked(updateAbusiveReport);
const deleteMock = jest.mocked(deleteAbusiveReport);
const rejectMock = jest.mocked(rejectAbusiveReports);

const CUSTOMER: CurrentUserPayload = {
  sub: 2,
  email: 'customer@demo.com',
  permissions: ['customer'],
  iat: 0,
  exp: 0,
};
const AT = new Date('2022-07-26T04:35:51.000Z');

function makeReport(
  overrides: Partial<AbusiveReportDetailRecord> = {},
): AbusiveReportDetailRecord {
  return {
    id: 3,
    userId: 2,
    modelType: 'Review',
    modelId: 1,
    message: 'xvcgfdgdfg',
    createdAt: AT,
    updatedAt: AT,
    user: {
      id: 2,
      name: 'Customer',
      email: 'customer@demo.com',
      isActive: true,
      emailVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
    ...overrides,
  };
}

describe('AbusiveReportService', () => {
  let service: AbusiveReportService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AbusiveReportService();
  });

  it('la lista es {data} con las 8 claves del mock y model_type FQCN', async () => {
    listMock.mockResolvedValue([makeReport()]);
    const { data } = JSON.parse(JSON.stringify(await service.findAllReports()));
    expect(Object.keys(data[0])).toEqual([
      'id',
      'user_id',
      'model_type',
      'model_id',
      'message',
      'created_at',
      'updated_at',
      'user',
    ]);
    expect(data[0].model_type).toBe('Marvel\\Database\\Models\\Review');
    expect(data[0].created_at).toBe('2022-07-26T04:35:51.000Z');
    expect(data[0].user.is_active).toBe(1);
  });

  it('detalle o 404', async () => {
    findMock.mockResolvedValue(makeReport());
    expect((await service.findReport(3)).id).toBe(3);
    findMock.mockResolvedValue(null);
    await expect(service.findReport(3)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('create', () => {
    it.each(['Review', 'Marvel\\Database\\Models\\Review'])(
      'acepta model_type %s y lo guarda como nombre corto, con el autor del token',
      async (modelType) => {
        createMock.mockResolvedValue(makeReport({ modelId: 85 }));
        await service.create(
          {
            model_id: '85',
            model_type: modelType,
            message: 'zz',
          } as unknown as CreateReportDto,
          CUSTOMER,
        );
        expect(createMock).toHaveBeenCalledWith({
          userId: 2,
          modelType: 'Review',
          modelId: 85,
          message: 'zz',
        });
      },
    );

    it('tipo desconocido o model_id no válido ⇒ 400 sin escribir', async () => {
      for (const dto of [
        { model_id: 1, model_type: 'Product', message: 'x' },
        { model_id: 'abc', model_type: 'Review', message: 'x' },
      ]) {
        await expect(
          service.create(dto as unknown as CreateReportDto, CUSTOMER),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(createMock).not.toHaveBeenCalled();
    });

    it.each(['Question', 'Marvel\\Database\\Models\\Question'])(
      'reporta una pregunta con model_type %s (US-55) y emite el FQCN',
      async (modelType) => {
        createMock.mockResolvedValue(
          makeReport({ modelType: 'Question', modelId: 68 }),
        );
        const dto = {
          model_id: 68,
          model_type: modelType,
          message: 'x',
        } as unknown as CreateReportDto;
        const result = await service.create(dto, CUSTOMER);
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({ modelType: 'Question', modelId: 68 }),
        );
        expect(result.model_type).toBe('Marvel\\Database\\Models\\Question');
      },
    );

    it('404, 400 y 409 del repositorio se mapean', async () => {
      const question = {
        model_id: 999,
        model_type: 'Question',
        message: 'x',
      } as unknown as CreateReportDto;
      createMock.mockRejectedValueOnce(
        new RecordNotFoundError('questions', 999),
      );
      await expect(service.create(question, CUSTOMER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      createMock.mockRejectedValueOnce(
        new InvalidFieldValueError(
          'abusive_reports',
          'message',
          '',
          'abusive_reports_message_check',
        ),
      );
      await expect(service.create(question, CUSTOMER)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const review = {
        model_id: 85,
        model_type: 'Review',
        message: 'x',
      } as unknown as CreateReportDto;
      createMock.mockRejectedValueOnce(new RecordNotFoundError('reviews', 85));
      await expect(service.create(review, CUSTOMER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      createMock.mockRejectedValueOnce(
        new SlugConflictError('abusive_reports', 'user_id'),
      );
      await expect(service.create(review, CUSTOMER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('update edita solo el mensaje; delete devuelve el reporte; 404 si no existe', async () => {
    updateMock.mockResolvedValue(makeReport({ message: 'nuevo' }));
    expect(
      (
        await service.update(3, {
          message: 'nuevo',
          model_id: 9,
        } as UpdateReportDto)
      ).message,
    ).toBe('nuevo');
    expect(updateMock).toHaveBeenCalledWith(3, { message: 'nuevo' });
    deleteMock.mockResolvedValue(makeReport());
    expect((await service.delete(3)).id).toBe(3);
    deleteMock.mockRejectedValue(new RecordNotFoundError('abusive_reports', 3));
    await expect(service.delete(3)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('reject (US-65)', () => {
    it('sin model_type vale Review (lo que manda el admin hoy) y responde con el FQCN y el conteo', async () => {
      rejectMock.mockResolvedValue(1);
      expect(await service.reject({ model_id: 1 })).toEqual({
        model_type: 'Marvel\\Database\\Models\\Review',
        model_id: 1,
        deleted: 1,
      });
      expect(rejectMock).toHaveBeenCalledWith('Review', 1);
    });

    it.each([
      ['Review', 'Review'],
      ['Marvel\\Database\\Models\\Review', 'Review'],
      ['Question', 'Question'],
    ])(
      'model_type %s se normaliza a %s; un id string numérico vale',
      async (input, short) => {
        rejectMock.mockResolvedValue(0);
        const result = await service.reject({
          model_id: '21',
          model_type: input,
        });
        expect(rejectMock).toHaveBeenCalledWith(short, 21);
        expect(result.deleted).toBe(0);
      },
    );

    it('model_id ausente o inválido, o model_type no reportable ⇒ 400 sin tocar la base', async () => {
      for (const dto of [
        {},
        { model_id: 'abc' },
        { model_id: 0 },
        { model_id: 1, model_type: 'Product' },
      ]) {
        await expect(service.reject(dto)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(rejectMock).not.toHaveBeenCalled();
    });

    it('objeto inexistente ⇒ 404', async () => {
      rejectMock.mockRejectedValue(new RecordNotFoundError('reviews', 999999));
      await expect(service.reject({ model_id: 999999 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
