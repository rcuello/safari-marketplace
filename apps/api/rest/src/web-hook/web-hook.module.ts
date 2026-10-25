import { Module } from '@nestjs/common';
import { WebHookController } from './web-hook.controller.js';
import { WebHookService } from './web-hook.service.js';

@Module({
  controllers: [WebHookController],
  providers: [WebHookService],
})
export class WebHookModule {}
