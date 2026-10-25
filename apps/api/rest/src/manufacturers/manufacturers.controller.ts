import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ManufacturersService } from './manufacturers.service.js';
import { GetTopManufacturersDto } from './dto/get-top-manufacturers.dto.js';
import { Manufacturer } from './entities/manufacturer.entity.js';
import {
  GetManufacturersDto,
  ManufacturerPaginator,
} from './dto/get-manufactures.dto.js';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto.js';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Controller('manufacturers')
export class ManufacturersController {
  constructor(private readonly manufacturersService: ManufacturersService) {}

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Post()
  createProduct(@Body() createManufactureDto: CreateManufacturerDto) {
    return this.manufacturersService.create(createManufactureDto);
  }

  @Public()
  @Get()
  async getManufactures(
    @Query() query: GetManufacturersDto,
  ): Promise<ManufacturerPaginator> {
    return this.manufacturersService.getManufactures(query);
  }

  @Public()
  @Get(':slug')
  async getManufactureBySlug(
    @Param('slug') slug: string,
  ): Promise<Manufacturer> {
    return this.manufacturersService.getManufacturesBySlug(slug);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateManufacturerDto: UpdateManufacturerDto,
  ) {
    return this.manufacturersService.update(+id, updateManufacturerDto);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.manufacturersService.remove(+id);
  }
}

@Public()
@Controller('top-manufacturers')
export class TopManufacturersController {
  constructor(private readonly manufacturersService: ManufacturersService) {}

  @Get()
  async getTopManufactures(
    @Query() query: GetTopManufacturersDto,
  ): Promise<Manufacturer[]> {
    return this.manufacturersService.getTopManufactures(query);
  }
}
