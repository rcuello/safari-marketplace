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
import { CreateQuestionDto } from './dto/create-question.dto';
import { GetQuestionDto } from './dto/get-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { MyQuestionsService } from './my-questions.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';

@Controller('my-questions')
export class MyQuestionsController {
  constructor(private myQuestionService: MyQuestionsService) {}
  // show all
  // TODO: there is a bug in displaying all questions
  // In product single page front-end all the questions apperaed. It should be based on product ID.
  // Todas las rutas son del usuario que llama (US-55): lo ajeno es 404.
  @Get()
  findAll(@Query() query: GetQuestionDto, @CurrentUser() user: CurrentUserPayload) {
    return this.myQuestionService.findMyQuestions(user.sub, query);
  }
  // show one
  @Get(':id')
  find(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.myQuestionService.findMyQuestion(user.sub, +id);
  }
  // create
  @Post()
  create(
    @Body() createQuestionDto: CreateQuestionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.myQuestionService.create(createQuestionDto, user);
  }

  // update — el autor edita el texto de su pregunta
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.myQuestionService.update(user.sub, +id, updateQuestionDto);
  }

  // delete
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.myQuestionService.delete(user.sub, +id);
  }
}
