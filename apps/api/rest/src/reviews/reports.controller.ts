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
import { UpdateReportDto } from './dto/update-report.dto';
import { AbusiveReportService } from './reports.service';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('abusive_reports')
export class AbusiveReportsController {
  constructor(private reportService: AbusiveReportService) {}

  // Moderación (toda aprobación es ADMIN_ONLY, design.md Decisión B).
  @Permissions(...ADMIN_ONLY)
  @Get()
  async findAll() {
    return this.reportService.findAllReports();
  }

  // get single feedback
  @Permissions(...ADMIN_ONLY)
  @Get(':id')
  find(@Param('id') id: number) {
    return this.reportService.findReport(id);
  }

  // create a new feedback — escritura UGC de un usuario autenticado (default).
  @Post()
  create(@Body() createReportDto: CreateReportDto) {
    return this.reportService.create(createReportDto);
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
