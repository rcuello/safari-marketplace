import { Controller, Get } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

@Controller('my-reports')
export class ReportsController {
  constructor(private myReportService: ReportsService) {}

  // Get All — solo los reportes del usuario que llama (US-54).
  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.myReportService.findMyReports(user.sub);
  }
}
