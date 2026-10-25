import { Module } from '@nestjs/common';
import { MyWishlistsController } from './my-wishlists.controller.js';
import { MyWishlistService } from './my-wishlists.service.js';
import { WishlistsController } from './wishlists.controller.js';
import { WishlistsService } from './wishlists.service.js';

@Module({
  controllers: [WishlistsController, MyWishlistsController],
  providers: [WishlistsService, MyWishlistService],
})
export class WishlistsModule {}
