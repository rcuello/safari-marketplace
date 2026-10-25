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
import { FaqsService } from './faqs.service.js';
import { GetFaqsDto } from './dto/get-faqs.dto.js';
import { CreateFaqDto } from './dto/create-faq.dto.js';
import { UpdateFaqDto } from './dto/update-faq.dto.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';

@Controller('faqs')
export class FaqsController {
  constructor(private faqService: FaqsService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  createFaq(
    @Body() createFaqDto: CreateFaqDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.faqService.create(createFaqDto, user.sub);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetFaqsDto) {
    return this.faqService.findAllFaqs(query);
  }

  @Public()
  @Get(':param')
  getFaq(@Param('param') param: string, @Query('language') language: string) {
    return this.faqService.getFaq(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateFaqDto: UpdateFaqDto,
  ) {
    return this.faqService.update(+id, updateFaqDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  deleteFaq(@Param('id') id: string) {
    return this.faqService.remove(+id);
  }
}
