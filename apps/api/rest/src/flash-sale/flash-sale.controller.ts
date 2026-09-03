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
import { FlashSaleService } from './flash-sale.service';
import { GetFlashSaleDto } from './dto/get-flash-sales.dto';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import {
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';

@Controller('flash-sale')
export class FlashSaleController {
  constructor(private flashSaleService: FlashSaleService) {}

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Post()
  createFlashSale(@Body() createFlashSaleDto: CreateFlashSaleDto) {
    return this.flashSaleService.create(createFlashSaleDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetFlashSaleDto) {
    return this.flashSaleService.findAllFlashSale(query);
  }

  @Public()
  @Get(':param')
  getFlashSale(
    @Param('param') param: string,
    @Query('language') language: string,
  ) {
    return this.flashSaleService.getFlashSale(param, language);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateFlashSaleDto: UpdateFlashSaleDto,
  ) {
    return this.flashSaleService.update(+id, updateFlashSaleDto);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  deleteFlashSale(@Param('id') id: string) {
    return this.flashSaleService.remove(+id);
  }
}

@Public()
@Controller('products-by-flash-sale')
export class ProductsByFlashSaleController {
  constructor(private flashSaleService: FlashSaleService) {}

  @Get()
  findAll(@Query() query: GetFlashSaleDto) {
    return this.flashSaleService.findAllProductsByFlashSale(query);
  }
}
