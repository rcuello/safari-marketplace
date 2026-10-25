import { Module } from '@nestjs/common';
import { NotifyLogsController } from './notify-logs.controller.js';
import { NotifyLogsService } from './notify-logs.service.js';

@Module({
  controllers: [NotifyLogsController],
  providers: [NotifyLogsService],
})
export class NotifyLogsModule {}
