import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { CreateAiDto } from './dto/create-ai.dto.js';
import {
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Permissions(...ADMIN_ONLY)
@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-descriptions')
  create(@Body() createAiDto: CreateAiDto) {
    return this.aiService.create(createAiDto);
  }
}
