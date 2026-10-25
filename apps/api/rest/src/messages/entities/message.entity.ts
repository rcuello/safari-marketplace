import {
  Conversation,
  LatestMessage,
} from '#src/conversations/entities/conversation.entity.js';

export class Message extends LatestMessage {
  conversation: Conversation;
}
