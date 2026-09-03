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
import { ShopsService } from './shops.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { GetShopsDto, ShopPaginator } from './dto/get-shops.dto';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { UserPaginator } from 'src/users/dto/get-users.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import {
  ADMIN_AND_OWNER,
  ADMIN_ONLY,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Permissions(...ADMIN_AND_OWNER)
  @Post()
  create(@Body() createShopDto: CreateShopDto) {
    return this.shopsService.create(createShopDto);
  }

  @Public()
  @Get()
  async getShops(@Query() query: GetShopsDto): Promise<ShopPaginator> {
    return this.shopsService.getShops(query);
  }

  @Public()
  @Get(':slug')
  async getShop(@Param('slug') slug: string) {
    return this.shopsService.getShop(slug);
  }

  @Permissions(...ADMIN_AND_OWNER)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateShopDto: UpdateShopDto) {
    return this.shopsService.update(+id, updateShopDto);
  }

  @Permissions(...ADMIN_AND_OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shopsService.remove(+id);
  }

  // Moderación (toda aprobación es ADMIN_ONLY, design.md Decisión B).
  @Permissions(...ADMIN_ONLY)
  @Post('approve')
  approveShop(@Param('id') id: string) {
    return this.shopsService.approve(+id);
  }

  @Permissions(...ADMIN_ONLY)
  @Post('disapprove')
  disapproveShop(@Param('id') id: string) {
    return this.shopsService.approve(+id);
  }
}

@Permissions(...ADMIN_AND_OWNER)
@Controller('staffs')
export class StaffsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Post()
  create(@Body() createShopDto: CreateShopDto) {
    return this.shopsService.create(createShopDto);
  }

  @Get()
  async getStaffs(@Query() query: GetStaffsDto): Promise<UserPaginator> {
    return this.shopsService.getStaffs(query);
  }

  @Get(':slug')
  async getShop(@Param('slug') slug: string) {
    return this.shopsService.getShop(slug);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateShopDto: UpdateShopDto) {
    return this.shopsService.update(+id, updateShopDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shopsService.remove(+id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('disapprove-shop')
export class DisapproveShopController {
  constructor(private shopsService: ShopsService) {}

  @Post()
  async disapproveShop(@Body('id') id) {
    return this.shopsService.disapproveShop(id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('approve-shop')
export class ApproveShopController {
  constructor(private shopsService: ShopsService) {}

  @Post()
  async approveShop(@Body('id') id) {
    return this.shopsService.approveShop(id);
  }
}

@Public()
@Controller('near-by-shop')
export class NearByShopController {
  constructor(private shopsService: ShopsService) {}

  @Get(':lat/:lng')
  async getNearByShop(@Param('lat') lat: string, @Param('lng') lng: string) {
    return this.shopsService.getNearByShop(lat, lng);
  }
}

// Cola de aprobación del admin (cierre del usuario, proposal.md).
@Permissions(...ADMIN_ONLY)
@Controller('new-shops')
export class NewShopsController {
  constructor(private shopsService: ShopsService) {}

  @Get()
  async getNewShops(@Query() query: GetShopsDto): Promise<ShopPaginator> {
    return this.shopsService.getNewShops(query);
  }
}
