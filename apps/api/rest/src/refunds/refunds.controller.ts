import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { UpdateRefundDto } from './dto/update-refund.dto';
import {
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  create(@Body() createRefundDto: CreateRefundDto) {
    return this.refundsService.create(createRefundDto);
  }

  // D-8 (design.md, Decisión G): el filtro de propiedad NO es cableable hoy
  // — `findAll()` no recibe `@Query()` y `RefundsService.findAll()` no
  // acepta argumentos (devuelve `{data: []}` fijo). Queda autenticado
  // (deny-by-default) hasta que US-25 haga real el servicio.
  @Get()
  findAll() {
    return this.refundsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.refundsService.findOne(+id);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRefundDto: UpdateRefundDto) {
    return this.refundsService.update(+id, updateRefundDto);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.refundsService.remove(+id);
  }
}
