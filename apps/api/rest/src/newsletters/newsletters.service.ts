import { Injectable } from '@nestjs/common';
import { CreateNewSubscriberDto } from './dto/create-new-subscriber.dto.js';

@Injectable()
export class NewslettersService {
  async subscribeToNewsletter({ email: _email }: CreateNewSubscriberDto) {
    return `Your email successfully subscribed`;
  }
}
