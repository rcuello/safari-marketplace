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
import { TagsService } from './tags.service.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';
import { GetTagsDto, TagPaginator } from './dto/get-tags.dto.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  create(@Body() createTagDto: CreateTagDto) {
    return this.tagsService.create(createTagDto);
  }

  @Public()
  @Get()
  async findAll(@Query() query: GetTagsDto): Promise<TagPaginator> {
    return this.tagsService.findAll(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.tagsService.findOne(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateTagDto: UpdateTagDto) {
    return this.tagsService.update(+id, updateTagDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tagsService.remove(+id);
  }
}
