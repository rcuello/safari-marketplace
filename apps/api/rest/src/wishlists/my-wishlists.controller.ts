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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';
import { CreateWishlistDto } from './dto/create-wishlists.dto.js';
import { GetWishlistDto } from './dto/get-wishlists.dto.js';
import { MyWishlistService } from './my-wishlists.service.js';

// Misma lista por usuario que `wishlists` (US-53); `:id` es un id de producto.
@Controller('my-wishlists')
export class MyWishlistsController {
  constructor(private myWishlistService: MyWishlistService) {}

  // Get All
  @Get()
  findAll(
    @Query() query: GetWishlistDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.myWishlistService.findAll(user.sub, query);
  }
  // Get single
  @Get(':id')
  find(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.myWishlistService.findOne(user.sub, id);
  }

  // create
  @Post()
  create(
    @Body() createWishlistDto: CreateWishlistDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.myWishlistService.add(user.sub, createWishlistDto.product_id);
  }

  // update: upsert del producto `:id`; el body se ignora.
  @Put(':id')
  update(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.myWishlistService.add(user.sub, id);
  }

  // delete
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.myWishlistService.remove(user.sub, id);
  }
}
