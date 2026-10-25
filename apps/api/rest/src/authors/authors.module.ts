import { Module } from '@nestjs/common';
import { AuthorsService } from './authors.service.js';
import { AuthorsController, TopAuthors } from './authors.controller.js';

@Module({
  controllers: [AuthorsController, TopAuthors],
  providers: [AuthorsService],
})
export class AuthorsModule {}
