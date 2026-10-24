/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `MessagesService` (US-56) y de `markSeen` (US-64). Solo
 * se mockea el acceso a datos.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createMessage,
  findConversationById,
  InvalidFieldValueError,
  listMessages,
  markConversationSeen,
  type ConversationDetailRecord,
  type MessageDetailRecord,
  type ShopRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { GetConversationsDto } from 'src/conversations/dto/get-conversations.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessagesService } from './messages.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  findConversationById: jest.fn(),
  listMessages: jest.fn(),
  createMessage: jest.fn(),
  markConversationSeen: jest.fn(),
}));

const findMock = jest.mocked(findConversationById);
const listMock = jest.mocked(listMessages);
const createMock = jest.mocked(createMessage);
const seenMock = jest.mocked(markConversationSeen);

const AT = new Date('2023-03-21T03:18:35.000Z');
const ADMIN: CurrentUserPayload = {
  sub: 3,
  email: 'admin@demo.com',
  permissions: ['super_admin'],
  iat: 0,
  exp: 0,
};

function makeConversation(overrides: Partial<ConversationDetailRecord> = {}): ConversationDetailRecord {
  return {
    id: 1,
    userId: 3,
    shopId: 7,
    createdAt: AT,
    updatedAt: AT,
    user: {
      id: 3,
      name: 'Jhon Doe',
      email: 'admin@demo.com',
      isActive: true,
      emailVerifiedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
    shop: { id: 7, ownerId: 1, name: 'Gadget Shop', slug: 'gadget-shop', isActive: true } as unknown as ShopRecord,
    latestMessage: { id: 5, conversationId: 1, userId: 3, body: 'New test', createdAt: AT, updatedAt: AT },
    lastSeenAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MessageDetailRecord> = {}): MessageDetailRecord {
  return {
    id: 5,
    conversationId: 1,
    userId: 3,
    body: 'New test',
    createdAt: AT,
    updatedAt: AT,
    conversation: makeConversation(),
    ...overrides,
  };
}

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MessagesService();
  });

  describe('getMessages', () => {
    it('solo los de la conversación, con paginador y la forma de messages.json', async () => {
      findMock.mockResolvedValue(makeConversation());
      listMock.mockResolvedValue({ items: [makeMessage()], total: 1 });
      const result = JSON.parse(
        JSON.stringify(await service.getMessages('1', { limit: '10' } as unknown as GetConversationsDto, ADMIN)),
      );
      expect(listMock).toHaveBeenCalledWith(1, { page: 1, limit: 10, readerId: 3 });
      expect(result).toMatchObject({ total: 1, current_page: 1, last_page: 1, per_page: '10' });
      expect(result.first_page_url).toBe('http://localhost:5000/api/messages/conversations/1?limit=10&page=1');
      const m = result.data[0];
      expect(Object.keys(m)).toEqual(['id', 'conversation_id', 'user_id', 'body', 'created_at', 'updated_at', 'conversation']);
      expect(m).toMatchObject({ id: 5, conversation_id: 1, user_id: 3 });
      expect(Object.keys(m.conversation)).toEqual([
        'id', 'user_id', 'shop_id', 'created_at', 'updated_at', 'latest_message', 'unseen', 'shop', 'user',
      ]);
      expect(m.conversation).toMatchObject({ id: 1, user_id: 3, shop_id: 7, unseen: 0 });
      expect(m.conversation.latest_message).toMatchObject({ id: 5, conversation_id: 1, user_id: 3 });
      expect(m.conversation.user).toMatchObject({ id: 3, is_active: 1, shop_id: null, profile: null });
    });

    it('limit 15 por defecto; conversación ajena o inexistente ⇒ 404 sin listar', async () => {
      findMock.mockResolvedValue(makeConversation());
      listMock.mockResolvedValue({ items: [], total: 0 });
      expect((await service.getMessages('1', {} as GetConversationsDto, ADMIN)).per_page).toBe(15);
      findMock.mockResolvedValue(null);
      listMock.mockClear();
      await expect(service.getMessages('999', {} as GetConversationsDto, ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(listMock).not.toHaveBeenCalled();
    });
  });

  describe('createMessage', () => {
    it('inserta en la conversación de la ruta con el autor del token', async () => {
      findMock.mockResolvedValue(makeConversation());
      createMock.mockResolvedValue(makeMessage({ id: 6, body: 'hola' }));
      const result = await service.createMessage('1', { body: 'hola' } as CreateMessageDto, ADMIN);
      expect(createMock).toHaveBeenCalledWith({ conversationId: 1, userId: 3, body: 'hola' });
      expect(result).toMatchObject({ id: 6, body: 'hola' });
    });

    it('cuerpo vacío ⇒ 400; conversación no visible ⇒ 404 sin escribir', async () => {
      findMock.mockResolvedValue(makeConversation());
      createMock.mockRejectedValue(new InvalidFieldValueError('messages', 'body', '', 'messages_body_check'));
      await expect(service.createMessage('1', { body: '' } as CreateMessageDto, ADMIN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      findMock.mockResolvedValue(null);
      createMock.mockClear();
      await expect(service.createMessage('1', { body: 'x' } as CreateMessageDto, ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('markSeen (US-64)', () => {
    const OWNER: CurrentUserPayload = { ...ADMIN, sub: 1, permissions: ['store_owner', 'customer'] };

    it('marca con la visibilidad de quien llama y devuelve la conversación con unseen 0', async () => {
      seenMock.mockResolvedValue(makeConversation({ lastSeenAt: AT }));
      const dto = await service.markSeen('1', OWNER);
      expect(seenMock).toHaveBeenCalledWith(1, { userId: 1, seeAll: false });
      expect(dto).toMatchObject({ id: '1', unseen: 0 });
    });

    it('ajena, inexistente o id no numérico ⇒ 404', async () => {
      seenMock.mockResolvedValue(null);
      await expect(service.markSeen('1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.markSeen('abc', OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(seenMock).toHaveBeenCalledTimes(1);
    });
  });
});
