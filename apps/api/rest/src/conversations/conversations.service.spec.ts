/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `ConversationsService` (US-56). Solo se mockea el
 * acceso a datos; los proyectores son los reales.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  findConversationById,
  findOrCreateConversation,
  InvalidReferenceError,
  listConversations,
  type ConversationDetailRecord,
  type ShopRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetConversationsDto } from './dto/get-conversations.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listConversations: jest.fn(),
  findConversationById: jest.fn(),
  findOrCreateConversation: jest.fn(),
}));

const listMock = jest.mocked(listConversations);
const findMock = jest.mocked(findConversationById);
const upsertMock = jest.mocked(findOrCreateConversation);

const AT = new Date('2023-03-11T03:17:23.000Z');
const ADMIN: CurrentUserPayload = {
  sub: 3,
  email: 'admin@demo.com',
  permissions: ['super_admin', 'customer', 'store_owner'],
  iat: 0,
  exp: 0,
};
const OWNER: CurrentUserPayload = { ...ADMIN, sub: 1, permissions: ['store_owner', 'customer'] };

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
    shop: {
      id: 7,
      ownerId: 1,
      name: 'Gadget Shop',
      slug: 'gadget-shop',
      description: null,
      coverImage: null,
      logo: null,
      isActive: true,
      address: {},
      settings: {},
      createdAt: AT,
      updatedAt: AT,
    } as unknown as ShopRecord,
    latestMessage: {
      id: 5,
      conversationId: 1,
      userId: 3,
      body: 'New test',
      createdAt: AT,
      updatedAt: AT,
    },
    lastSeenAt: null,
    ...overrides,
  };
}

describe('ConversationsService', () => {
  let service: ConversationsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ConversationsService();
  });

  describe('DTO', () => {
    it('emite las claves del mock en su orden, sin __typename, con ids string y unseen numérico', async () => {
      findMock.mockResolvedValue(makeConversation());
      const dto = JSON.parse(JSON.stringify(await service.getConversation('1', ADMIN)));
      expect(Object.keys(dto)).toEqual([
        'user_id', 'id', 'shop_id', 'unseen', 'created_at', 'updated_at', 'shop', 'user', 'latest_message',
      ]);
      expect(dto).toMatchObject({ user_id: '3', id: '1', shop_id: '7', unseen: 0 });
      expect(dto.user).toEqual({
        id: '3',
        name: 'Jhon Doe',
        email: 'admin@demo.com',
        profile: null,
        address: [],
        wallet: null,
        is_active: true,
      });
      expect(dto.latest_message).toEqual({
        body: 'New test',
        conversation_id: '1',
        created_at: AT.toISOString(),
        updated_at: AT.toISOString(),
        user_id: '3',
        id: '5',
      });
      expect(Object.keys(dto.shop)).toHaveLength(16);
    });

    it('unseen es 1 si el último mensaje es de otro y 0 sin mensajes', async () => {
      findMock.mockResolvedValue(makeConversation());
      expect((await service.getConversation('1', OWNER)).unseen).toBe(1);
      findMock.mockResolvedValue(makeConversation({ latestMessage: null }));
      const dto = await service.getConversation('1', OWNER);
      expect(dto.unseen).toBe(0);
      expect(dto.latest_message).toBeNull();
    });

    it('US-64: la lectura apaga unseen y un mensaje posterior lo vuelve a encender', async () => {
      findMock.mockResolvedValue(makeConversation({ lastSeenAt: AT }));
      expect((await service.getConversation('1', OWNER)).unseen).toBe(0);
      findMock.mockResolvedValue(makeConversation({ lastSeenAt: new Date(AT.getTime() + 1) }));
      expect((await service.getConversation('1', OWNER)).unseen).toBe(0);
      findMock.mockResolvedValue(makeConversation({ lastSeenAt: new Date(AT.getTime() - 1) }));
      expect((await service.getConversation('1', OWNER)).unseen).toBe(1);
      // El último mensaje es suyo: 0 aunque nunca la haya leído.
      findMock.mockResolvedValue(makeConversation());
      expect((await service.getConversation('1', ADMIN)).unseen).toBe(0);
    });
  });

  describe('getConversation', () => {
    it('busca por id con la visibilidad de quien llama', async () => {
      findMock.mockResolvedValue(makeConversation());
      await service.getConversation('1', OWNER);
      expect(findMock).toHaveBeenCalledWith(1, { userId: 1, seeAll: false });
      await service.getConversation('1', ADMIN);
      expect(findMock).toHaveBeenLastCalledWith(1, { userId: 3, seeAll: true });
    });

    it('ajena, inexistente o id no numérico ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(service.getConversation('1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getConversation('abc', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAllConversations', () => {
    it('limit 15 por defecto, sin orderBy ⇒ id ASC, url del mock', async () => {
      listMock.mockResolvedValue({ items: [makeConversation()], total: 1 });
      const result = await service.getAllConversations({} as GetConversationsDto, ADMIN);
      expect(listMock).toHaveBeenCalledWith({
        viewer: { userId: 3, seeAll: true },
        shopName: undefined,
        orderBy: undefined,
        sortedBy: 'asc',
        page: 1,
        limit: 15,
      });
      expect(result.per_page).toBe(15);
      expect(result.first_page_url).toBe('http://localhost:5000/api/conversations?limit=15&page=1');
    });

    it('respeta orderBy=updated_at&sortedBy=desc y busca por nombre de tienda; claves desconocidas se ignoran', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.getAllConversations(
        { limit: '5', orderBy: 'updated_at', sortedBy: 'desc', search: 'gadget' } as unknown as GetConversationsDto,
        OWNER,
      );
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ shopName: 'gadget', orderBy: 'updated_at', sortedBy: 'desc', limit: 5 }),
      );
      await service.getAllConversations(
        { orderBy: 'password', search: 'shop.name:bags' } as unknown as GetConversationsDto,
        OWNER,
      );
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: undefined, shopName: 'bags' }));
    });
  });

  describe('create', () => {
    it('reutiliza o crea la del par (quien llama, tienda) e ignora `via`', async () => {
      upsertMock.mockResolvedValue(makeConversation());
      const result = await service.create({ shop_id: '7', via: 'admin' } as unknown as CreateConversationDto, ADMIN);
      expect(upsertMock).toHaveBeenCalledWith(3, 7);
      expect(result.id).toBe('1');
    });

    it('shop_id no numérico ⇒ 400; tienda inexistente ⇒ 400 (InvalidReferenceError)', async () => {
      await expect(
        service.create({ shop_id: 'x' } as unknown as CreateConversationDto, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      upsertMock.mockRejectedValue(new InvalidReferenceError('conversations', 'shop_id'));
      await expect(
        service.create({ shop_id: 999 } as unknown as CreateConversationDto, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
