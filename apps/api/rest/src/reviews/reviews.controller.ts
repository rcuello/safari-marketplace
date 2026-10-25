import {
  Controller,
  Get,
  Param,
  Query,
  Put,
  Post,
  Body,
  Delete,
} from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { GetReviewsDto } from './dto/get-reviews.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { ReviewService } from './reviews.service.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  CurrentUser,
  CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  //   find all reviews
  // TODO: there is a bug in displaying all reviews
  // front-end a issue ase with pobon paul
  // In product single page front-end all the reviews apperaed. It should be based on product ID.
  @Public()
  @Get()
  async findAll(@Query() query: GetReviewsDto) {
    return this.reviewService.findAllReviews(query);
  }

  //   find one review by ID
  @Public()
  @Get(':id')
  find(@Param('id') id: string) {
    return this.reviewService.findReview(+id);
  }

  //  create a new review — el autor es quien llama (US-54).
  @Post()
  create(
    @Body() createReviewDto: CreateReviewDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.reviewService.create(createReviewDto, user);
  }

  // Solo el autor o un super_admin (US-54).
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateReviewDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.reviewService.update(+id, updateReviewDto, user);
  }

  // delete a review — solo el autor o un super_admin (US-54).
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.reviewService.delete(+id, user);
  }
}
