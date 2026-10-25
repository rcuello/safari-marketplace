import { CoreEntity } from '#src/common/entities/core.entity.js';

export class NotifyLogs extends CoreEntity {
  receiver: string;
  sender: string;
  notify_type: string;
  notify_receiver_type: string;
  is_read: boolean;
  notify_text: string;
}
