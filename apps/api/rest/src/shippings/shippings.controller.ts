import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ShippingsService } from './shippings.service.js';
import { CreateShippingDto } from './dto/create-shipping.dto.js';
import { UpdateShippingDto } from './dto/update-shipping.dto.js';
import { GetShippingsDto } from './dto/get-shippings.dto.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Controller('shippings')
export class ShippingsController {
  constructor(private readonly shippingsService: ShippingsService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  create(@Body() createShippingDto: CreateShippingDto) {
    return this.shippingsService.create(createShippingDto);
  }

  // Referencia sin PII; romperla rompe el carrito anónimo (cierre del usuario, proposal.md).
  @Public()
  @Get()
  findAll(@Query() query: GetShippingsDto) {
    return this.shippingsService.getShippings(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shippingsService.findOne(+id);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateShippingDto: UpdateShippingDto,
  ) {
    return this.shippingsService.update(+id, updateShippingDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shippingsService.remove(+id);
  }
}
