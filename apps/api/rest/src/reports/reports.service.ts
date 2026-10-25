import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listAbusiveReportsByUser,
} from '@safari/db';
import { toReportDto } from '#src/reviews/review-dto.mapper.js';
import { MyReports } from './entities/report.entity.js';

/**
 * `/my-reports`: los reportes de abuso del usuario que llama,
 * `created_at DESC` (US-54). Antes servía las 3 filas del mock a cualquiera
 * (V-7). Sin paginador, como hoy.
 */
@Injectable()
export class ReportsService {
  async findMyReports(userId: number): Promise<{ data: MyReports[] }> {
    try {
      const records = await listAbusiveReportsByUser(userId);
      return {
        data: records.map((r) => toReportDto(r) as unknown as MyReports),
      };
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }
}
