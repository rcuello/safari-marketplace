import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { CreateAiDto } from './dto/create-ai.dto';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Permissions(...ADMIN_ONLY)
@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-descriptions')
  create(@Body() createAiDto: CreateAiDto) {
    return this.aiService.create(createAiDto);
  }
}
