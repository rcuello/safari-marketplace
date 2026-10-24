import { Injectable } from '@nestjs/common';
import { Product } from 'src/products/entities/product.entity';
import { GetWishlistDto } from './dto/get-wishlists.dto';
import { WishlistsService } from './wishlists.service';

export const MY_WISHLISTS_URL =
  '/my-wishlists?with=shop&orderBy=created_at&sortedBy=desc';

/**
 * `my-wishlists` es la misma lista que `wishlists` (US-53): antes servía
 * los productos 2..7 del mock a cualquiera (V-1). Solo cambia la url fija
 * del paginador.
 */
@Injectable()
export class MyWishlistService {
  constructor(private readonly wishlistsService: WishlistsService) {}

  findAll(userId: number, query: GetWishlistDto) {
    return this.wishlistsService.findAll(userId, query, MY_WISHLISTS_URL);
  }

  findOne(userId: number, id: unknown): Promise<Product> {
    return this.wishlistsService.findOne(userId, id);
  }

  add(userId: number, productId: unknown): Promise<Product> {
    return this.wishlistsService.add(userId, productId);
  }

  remove(userId: number, id: unknown): Promise<Product> {
    return this.wishlistsService.remove(userId, id);
  }
}
