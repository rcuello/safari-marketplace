import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { RejectReportDto } from './dto/reject-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { AbusiveReportService } from './reports.service';
import {
  ADMIN_ONLY,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';

@Controller('abusive_reports')
export class AbusiveReportsController {
  constructor(private reportService: AbusiveReportService) {}

  // Moderación (toda aprobación es ADMIN_ONLY, design.md Decisión B).
  @Permissions(...ADMIN_ONLY)
  @Get()
  async findAll() {
    return this.reportService.findAllReports();
  }

  // Rechazar los reportes de un objeto (US-65): el botón «Decline» del admin.
  // Antes de las rutas con `:id`, por convención del repo.
  @Permissions(...ADMIN_ONLY)
  @Post('reject')
  reject(@Body() rejectReportDto: RejectReportDto) {
    return this.reportService.reject(rejectReportDto);
  }

  // get single feedback
  @Permissions(...ADMIN_ONLY)
  @Get(':id')
  find(@Param('id') id: string) {
    return this.reportService.findReport(+id);
  }

  // create a new feedback — escritura UGC de un usuario autenticado (default).
  @Post()
  create(
    @Body() createReportDto: CreateReportDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.reportService.create(createReportDto, user);
  }

  // update a feedback
  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateReportDto: UpdateReportDto) {
    return this.reportService.update(+id, updateReportDto);
  }

  // delete a feedback
  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.reportService.delete(+id);
  }
}
