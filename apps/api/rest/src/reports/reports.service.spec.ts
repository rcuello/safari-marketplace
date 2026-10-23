/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `ReportsService` (`/my-reports`, US-54).
 */
import 'reflect-metadata';
import { listAbusiveReportsByUser } from '@safari/db';
import { ReportsService } from './reports.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listAbusiveReportsByUser: jest.fn(),
}));

const listMock = jest.mocked(listAbusiveReportsByUser);
const AT = new Date('2022-07-26T04:35:51.000Z');

describe('ReportsService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('devuelve {data} solo con los reportes del usuario que llama, sin paginador', async () => {
    listMock.mockResolvedValue([
      {
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
      },
    ]);
    const result = JSON.parse(JSON.stringify(await new ReportsService().findMyReports(2)));
    expect(listMock).toHaveBeenCalledWith(2);
    expect(Object.keys(result)).toEqual(['data']);
    expect(result.data[0]).toMatchObject({
      id: 3,
      model_type: 'Marvel\\Database\\Models\\Review',
      created_at: '2022-07-26T04:35:51.000Z',
    });
  });

  it('un usuario sin reportes recibe {data: []}', async () => {
    listMock.mockResolvedValue([]);
    expect(await new ReportsService().findMyReports(3)).toEqual({ data: [] });
  });
});
