import { PartialType } from '@nestjs/swagger';
import { CreateWishlistDto } from './create-wishlists.dto.js';

export class UpdateWishlistDto extends PartialType(CreateWishlistDto) {}
