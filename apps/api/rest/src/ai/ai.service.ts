import { Injectable } from '@nestjs/common';
import { CreateAiDto } from './dto/create-ai.dto.js';
import { Ai } from './entities/ai.entity.js';

@Injectable()
export class AiService {
  create(_createAiDto: CreateAiDto): Ai {
    return {
      status: 'success',
      result: 'This a dummy response for dummy api.',
    };
  }
}
