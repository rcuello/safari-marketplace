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
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';
import { CreateWishlistDto } from './dto/create-wishlists.dto';
import { GetWishlistDto } from './dto/get-wishlists.dto';
import { WishlistsService } from './wishlists.service';

// La lista es por usuario (US-53): toda ruta lee `@CurrentUser`. `:id` es
// siempre un id de PRODUCTO (no hay id de pivote); así llama el shop a DELETE.
@Controller('wishlists')
export class WishlistsController {
  constructor(private wishlistService: WishlistsService) {}

  // Get All
  @Get()
  findAll(
    @Query() query: GetWishlistDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.wishlistService.findAll(user.sub, query);
  }
  // Get single
  @Get(':id')
  find(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.findOne(user.sub, id);
  }

  // create
  @Post()
  create(
    @Body() createWishlistDto: CreateWishlistDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.wishlistService.add(user.sub, createWishlistDto.product_id);
  }

  // update: upsert del producto `:id`; el body se ignora.
  @Put(':id')
  update(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.add(user.sub, id);
  }

  // delete
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.remove(user.sub, id);
  }

  // wishlists/toggle
  @Post('/toggle')
  toggle(
    @Body() createWishlistDto: CreateWishlistDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.wishlistService.toggle(user.sub, createWishlistDto);
  }
  // /in_wishlist/{product_id}
  @Get('/in_wishlist/:product_id')
  inWishlist(
    @Param('product_id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.wishlistService.isInWishlist(user.sub, id);
  }
}
