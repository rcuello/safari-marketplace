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
}));

const listMock = jest.mocked(listAbusiveReports);
const findMock = jest.mocked(findAbusiveReportById);
const createMock = jest.mocked(createAbusiveReport);
const updateMock = jest.mocked(updateAbusiveReport);
const deleteMock = jest.mocked(deleteAbusiveReport);

const CUSTOMER: CurrentUserPayload = {
  sub: 2,
  email: 'customer@demo.com',
  permissions: ['customer'],
  iat: 0,
  exp: 0,
};
const AT = new Date('2022-07-26T04:35:51.000Z');

function makeReport(overrides: Partial<AbusiveReportDetailRecord> = {}): AbusiveReportDetailRecord {
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
      'id', 'user_id', 'model_type', 'model_id', 'message', 'created_at', 'updated_at', 'user',
    ]);
    expect(data[0].model_type).toBe('Marvel\\Database\\Models\\Review');
    expect(data[0].created_at).toBe('2022-07-26T04:35:51.000Z');
    expect(data[0].user.is_active).toBe(1);
  });

  it('detalle o 404', async () => {
    findMock.mockResolvedValue(makeReport());
    expect((await service.findReport(3)).id).toBe(3);
    findMock.mockResolvedValue(null);
    await expect(service.findReport(3)).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('create', () => {
    it.each(['Review', 'Marvel\\Database\\Models\\Review'])(
      'acepta model_type %s y lo guarda como nombre corto, con el autor del token',
      async (modelType) => {
        createMock.mockResolvedValue(makeReport({ modelId: 85 }));
        await service.create(
          { model_id: '85', model_type: modelType, message: 'zz' } as unknown as CreateReportDto,
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
        await expect(service.create(dto as unknown as CreateReportDto, CUSTOMER)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(createMock).not.toHaveBeenCalled();
    });

    it('Question pasa al repositorio, que responde 400 hasta US-55; 404 y 409 se mapean', async () => {
      const dto = { model_id: 1, model_type: 'Question', message: 'x' } as unknown as CreateReportDto;
      createMock.mockRejectedValueOnce(
        new InvalidFieldValueError('abusive_reports', 'model_type', 'Question', 'questions no existe hasta US-55'),
      );
      await expect(service.create(dto, CUSTOMER)).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ modelType: 'Question' }));

      const review = { model_id: 85, model_type: 'Review', message: 'x' } as unknown as CreateReportDto;
      createMock.mockRejectedValueOnce(new RecordNotFoundError('reviews', 85));
      await expect(service.create(review, CUSTOMER)).rejects.toBeInstanceOf(NotFoundException);
      createMock.mockRejectedValueOnce(new SlugConflictError('abusive_reports', 'user_id'));
      await expect(service.create(review, CUSTOMER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('update edita solo el mensaje; delete devuelve el reporte; 404 si no existe', async () => {
    updateMock.mockResolvedValue(makeReport({ message: 'nuevo' }));
    expect((await service.update(3, { message: 'nuevo', model_id: 9 } as UpdateReportDto)).message).toBe('nuevo');
    expect(updateMock).toHaveBeenCalledWith(3, { message: 'nuevo' });
    deleteMock.mockResolvedValue(makeReport());
    expect((await service.delete(3)).id).toBe(3);
    deleteMock.mockRejectedValue(new RecordNotFoundError('abusive_reports', 3));
    await expect(service.delete(3)).rejects.toBeInstanceOf(NotFoundException);
  });
});
