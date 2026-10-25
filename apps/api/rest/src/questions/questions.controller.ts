import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { GetQuestionDto } from './dto/get-questions.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { QuestionService } from './questions.service.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  CurrentUser,
  CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';

@Controller('questions')
export class QuestionController {
  constructor(private questionService: QuestionService) {}
  // show all
  // TODO: there is a bug in displaying all questions
  // In product single page front-end all the questions apperaed. It should be based on product ID.
  @Public()
  @Get()
  findAll(@Query() query: GetQuestionDto) {
    return this.questionService.findAllQuestions(query);
  }
  // show one
  @Public()
  @Get(':id')
  find(@Param('id') id: string) {
    return this.questionService.findQuestion(+id);
  }
  // create — el autor es quien llama (US-55).
  @Post()
  create(
    @Body() createQuestionDto: CreateQuestionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.questionService.create(createQuestionDto, user);
  }

  // update = responder: super_admin o dueño de la tienda (US-55).
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.questionService.update(+id, updateQuestionDto, user);
  }

  // delete — el autor, el dueño de la tienda o super_admin (US-55).
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.questionService.delete(+id, user);
  }
}
