/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Gate portante de PR3 (US-25): `UsersService` deja de leer `users.json` y
 * pasa a llamar funciones planas de `@safari/db`. Mismo arnés que
 * `shops.service.spec.ts:21-38,57` — se mockea SOLO el acceso a datos y se
 * dejan REALES `buildPaginator`/`isPrismaConnectionError`/
 * `getUserFriendlyMessage`/`DuplicateEmailError` (jest.requireActual), para
 * que la equivalencia con `paginate()` y la clasificación de errores se
 * prueben de verdad y sin base.
 *
 * `rawQuery()` existe porque `new ValidationPipe()` corre sin `transform`
 * (`main.ts:9`): en runtime `limit`/`page` llegan como strings crudas aunque
 * el DTO declare números — el bug real que D-B del design documenta.
 */
import 'reflect-metadata';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createUser,
  DuplicateEmailError,
  findUserWithRelations,
  grantPermission,
  listUsers,
  listUsersWithRelations,
  setUserActive,
  type UserWithRelations,
} from '@safari/db';
import type { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { UsersService } from './users.service';
import { GetUsersDto } from './dto/get-users.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy).
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listUsersWithRelations: jest.fn(),
  findUserWithRelations: jest.fn(),
  setUserActive: jest.fn(),
  listUsers: jest.fn(),
  grantPermission: jest.fn(),
  createUser: jest.fn(),
}));

const listUsersWithRelationsMock = jest.mocked(listUsersWithRelations);
const findUserWithRelationsMock = jest.mocked(findUserWithRelations);
const setUserActiveMock = jest.mocked(setUserActive);
const listUsersMock = jest.mocked(listUsers);
const grantPermissionMock = jest.mocked(grantPermission);
const createUserMock = jest.mocked(createUser);

function rawQuery(
  query: Record<string, string | number | undefined>,
): GetUsersDto {
  return query as unknown as GetUsersDto;
}

const FIXED_DATE = new Date('2026-09-02T15:33:36.102Z');

function buildFixture(overrides: Partial<UserWithRelations> = {}): UserWithRelations {
  return {
    id: 3,
    name: 'Jhon Doe',
    email: 'admin@demo.com',
    emailVerifiedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    isActive: true,
    profile: null,
    permissions: [],
    shops: [],
    ...overrides,
  };
}

function currentUser(sub: number): CurrentUserPayload {
  return { sub, email: 'x@x.com', permissions: [], iat: 0, exp: 0 };
}

describe('UsersService (US-25 PR3 — migración a Postgres)', () => {
  let service: UsersService;

  beforeEach(() => {
    listUsersWithRelationsMock.mockReset();
    findUserWithRelationsMock.mockReset();
    setUserActiveMock.mockReset();
    listUsersMock.mockReset();
    grantPermissionMock.mockReset();
    createUserMock.mockReset();
    service = new UsersService();
  });

  describe('getUsers — envoltorio de paginación (D-B, CRÍTICO)', () => {
    it('coincide clave por clave y por TIPO con paginate(), con limit="20" crudo (per_page string)', async () => {
      const items = [buildFixture({ id: 1 }), buildFixture({ id: 2 })];
      listUsersWithRelationsMock.mockResolvedValue({ items, total: 2 });

      const result = await service.getUsers(rawQuery({ limit: '20', page: '1' }));
      const { data, ...actualPagination } = result as unknown as Record<
        string,
        unknown
      >;

      // Repositorio recibe SIEMPRE valores numéricos (D-B guarda #1).
      expect(listUsersWithRelationsMock).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        text: undefined,
        permissionName: undefined,
      });

      const expected = paginate(2, 1, '20' as unknown as number, 2, '/users?limit=20');
      expect(Object.keys(actualPagination).sort()).toEqual(
        Object.keys(expected).sort(),
      );
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(actualPagination[key]).toStrictEqual(expected[key]);
      }
      // El punto crítico de D-B: per_page es la STRING cruda, no el número 20.
      expect(actualPagination.per_page).toBe('20');
      expect(typeof actualPagination.per_page).toBe('string');
      // Las 4 *_page_url son strings, nunca null (baseUrl siempre presente).
      expect(typeof actualPagination.first_page_url).toBe('string');
      expect(typeof actualPagination.last_page_url).toBe('string');
    });

    it('total=0 clampa current_page/last_page a 0 y lastItem a -1 (my-staffs/all-staffs reales)', async () => {
      listUsersWithRelationsMock.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getMyStaffs(rawQuery({ limit: 30, page: 1 }));

      expect(result.current_page).toBe(0);
      expect(result.last_page).toBe(0);
      expect(result.lastItem).toBe(-1);
      expect(result.data).toEqual([]);
    });

    it('my-staffs y all-staffs filtran el mismo permiso "staff" pero conservan su propia url (A2/V-7)', async () => {
      listUsersWithRelationsMock.mockResolvedValue({ items: [], total: 0 });

      const myStaffsResult = await service.getMyStaffs(
        rawQuery({ limit: 30, page: 1 }),
      );
      const allStaffsResult = await service.getAllStaffs(
        rawQuery({ limit: 30, page: 1 }),
      );

      expect(listUsersWithRelationsMock.mock.calls[0][0]).toMatchObject({
        permissionName: 'staff',
      });
      expect(listUsersWithRelationsMock.mock.calls[1][0]).toMatchObject({
        permissionName: 'staff',
      });
      expect(myStaffsResult.first_page_url).toContain('/my-staffs/list?limit=');
      expect(allStaffsResult.first_page_url).toContain('/all-staffs/list?limit=');
    });

    it('admin/vendors/customers filtran por el permiso correcto', async () => {
      listUsersWithRelationsMock.mockResolvedValue({ items: [], total: 0 });

      await service.getAdmin(rawQuery({ limit: 30, page: 1 }));
      await service.getVendors(rawQuery({ limit: 30, page: 1 }));
      await service.getAllCustomers(rawQuery({ limit: 30, page: 1 }));

      expect(listUsersWithRelationsMock.mock.calls[0][0]).toMatchObject({
        permissionName: 'super_admin',
      });
      expect(listUsersWithRelationsMock.mock.calls[1][0]).toMatchObject({
        permissionName: 'store_owner',
      });
      expect(listUsersWithRelationsMock.mock.calls[2][0]).toMatchObject({
        permissionName: 'customer',
      });
    });
  });

  describe('getUsersNotify — D-B guarda #2', () => {
    it('?limit=5 (string cruda) pasa take:5 (numérico) al repositorio, no "5"', async () => {
      listUsersWithRelationsMock.mockResolvedValue({ items: [], total: 0 });

      await service.getUsersNotify(rawQuery({ limit: '5' }));

      expect(listUsersWithRelationsMock).toHaveBeenCalledWith({
        page: 1,
        limit: 5,
      });
    });

    it('sin limit usa el default 30', async () => {
      listUsersWithRelationsMock.mockResolvedValue({ items: [], total: 0 });

      await service.getUsersNotify(rawQuery({}));

      expect(listUsersWithRelationsMock).toHaveBeenCalledWith({
        page: 1,
        limit: 30,
      });
    });

    it('devuelve un array plano de usuarios mapeados con toUserDto', async () => {
      listUsersWithRelationsMock.mockResolvedValue({
        items: [buildFixture({ id: 3 })],
        total: 1,
      });

      const result = await service.getUsersNotify(rawQuery({ limit: 30 }));

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect((result[0] as unknown as Record<string, unknown>).id).toBe(3);
    });
  });

  describe('findOne — D-B guarda #3 (404, nunca 500)', () => {
    it('id inexistente → 404', async () => {
      findUserWithRelationsMock.mockResolvedValue(null);

      await expect(service.findOne(99999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('id no numérico (NaN, de "/api/users/abc") → 404, nunca 500', async () => {
      await expect(service.findOne(Number('abc'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findUserWithRelationsMock).not.toHaveBeenCalled();
    });

    it('id existente devuelve las mismas 15 claves que /me', async () => {
      findUserWithRelationsMock.mockResolvedValue(buildFixture({ id: 3 }));

      const dto = await service.findOne(3);

      expect(Object.keys(dto as unknown as Record<string, unknown>)).toEqual([
        'id',
        'name',
        'email',
        'email_verified_at',
        'created_at',
        'updated_at',
        'is_active',
        'shop_id',
        'email_verified',
        'profile',
        'permissions',
        'wallet',
        'shops',
        'last_order',
        'address',
      ]);
    });
  });

  describe('block-user / unblock-user — CA-4', () => {
    it('block-user fija is_active:false explícitamente (setUserActive, sin invertir)', async () => {
      findUserWithRelationsMock.mockResolvedValue(
        buildFixture({ id: 2, permissions: [] }),
      );
      setUserActiveMock.mockResolvedValue({
        id: 2,
        name: 'Jhon Doe',
        email: 'customer@demo.com',
        isActive: false,
        emailVerifiedAt: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });

      await service.banUser(2, currentUser(1));

      expect(setUserActiveMock).toHaveBeenCalledWith(2, false);
    });

    it('unblock-user fija is_active:true explícitamente, sin guardas de negocio', async () => {
      findUserWithRelationsMock.mockResolvedValue(
        buildFixture({ id: 2, permissions: [] }),
      );
      setUserActiveMock.mockResolvedValue({
        id: 2,
        name: 'Jhon Doe',
        email: 'customer@demo.com',
        isActive: true,
        emailVerifiedAt: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });

      await service.activeUser(2);

      expect(setUserActiveMock).toHaveBeenCalledWith(2, true);
    });

    it('unblock-user con id inexistente → 404', async () => {
      findUserWithRelationsMock.mockResolvedValue(null);

      await expect(service.activeUser(99999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409 al bloquearse a sí mismo (@CurrentUser().sub === id)', async () => {
      await expect(
        service.banUser(1, currentUser(1)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(findUserWithRelationsMock).not.toHaveBeenCalled();
    });

    it('409 al bloquear al único usuario super_admin (conteo sin filtrar isActive)', async () => {
      findUserWithRelationsMock.mockResolvedValue(
        buildFixture({
          id: 3,
          permissions: [
            {
              id: 1,
              name: 'super_admin',
              guardName: 'api',
              createdAt: FIXED_DATE,
              updatedAt: FIXED_DATE,
            },
          ],
        }),
      );
      listUsersMock.mockResolvedValue({ items: [], total: 1 });

      await expect(
        service.banUser(3, currentUser(1)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(setUserActiveMock).not.toHaveBeenCalled();
    });

    it('bloquear a un super_admin cuando hay más de uno NO lanza 409', async () => {
      findUserWithRelationsMock.mockResolvedValue(
        buildFixture({
          id: 3,
          permissions: [
            {
              id: 1,
              name: 'super_admin',
              guardName: 'api',
              createdAt: FIXED_DATE,
              updatedAt: FIXED_DATE,
            },
          ],
        }),
      );
      listUsersMock.mockResolvedValue({ items: [], total: 2 });
      setUserActiveMock.mockResolvedValue({
        id: 3,
        name: 'Jhon Doe',
        email: 'admin@demo.com',
        isActive: false,
        emailVerifiedAt: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });

      await expect(
        service.banUser(3, currentUser(1)),
      ).resolves.toBeDefined();
      expect(setUserActiveMock).toHaveBeenCalledWith(3, false);
    });

    it('block-user con id no numérico → 404, nunca 500', async () => {
      await expect(
        service.banUser(Number('abc'), currentUser(1)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('make-admin — D-H/D-5', () => {
    it('convierte el user_id (string) a número y concede super_admin', async () => {
      grantPermissionMock.mockResolvedValue(buildFixture({ id: 2 }));

      await service.makeAdmin('2');

      expect(grantPermissionMock).toHaveBeenCalledWith(2, 'super_admin');
    });

    it('user_id no numérico → 404, nunca 500', async () => {
      await expect(service.makeAdmin('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(grantPermissionMock).not.toHaveBeenCalled();
    });

    it('usuario inexistente (grantPermission → null) → 404', async () => {
      grantPermissionMock.mockResolvedValue(null);

      await expect(service.makeAdmin('99999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create — POST /api/users', () => {
    it('crea con permiso customer fijo y devuelve las 15 claves (2ª lectura)', async () => {
      createUserMock.mockResolvedValue({
        id: 4,
        name: 'Nuevo',
        email: 'nuevo@demo.com',
        isActive: true,
        emailVerifiedAt: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });
      findUserWithRelationsMock.mockResolvedValue(buildFixture({ id: 4 }));

      await service.create({
        name: 'Nuevo',
        email: 'nuevo@demo.com',
        password: 'secreto123',
      } as never);

      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ permissionNames: ['customer'] }),
      );
      expect(findUserWithRelationsMock).toHaveBeenCalledWith(4);
    });

    it('email duplicado → 409, nunca 500', async () => {
      createUserMock.mockRejectedValue(new DuplicateEmailError('dup@demo.com'));

      await expect(
        service.create({
          name: 'Dup',
          email: 'dup@demo.com',
          password: 'secreto123',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('error de conexión a la base → 503', async () => {
      const error = new Error("Can't reach database server at `localhost:5433`");
      error.name = 'PrismaClientInitializationError';
      createUserMock.mockRejectedValue(error);

      await expect(
        service.create({
          name: 'X',
          email: 'x@demo.com',
          password: 'secreto123',
        } as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('cualquier otro error → 500, sin crashear', async () => {
      createUserMock.mockRejectedValue(new Error('boom inesperado'));

      await expect(
        service.create({
          name: 'X',
          email: 'x@demo.com',
          password: 'secreto123',
        } as never),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('update — PUT stub (A11, no persiste)', () => {
    it('devuelve el usuario actual sin aplicar el body', async () => {
      findUserWithRelationsMock.mockResolvedValue(buildFixture({ id: 3, name: 'Original' }));

      const dto = await service.update(3, {
        name: 'Otro nombre',
      } as never);

      expect((dto as unknown as Record<string, unknown>).name).toBe('Original');
    });

    it('id inexistente → 404', async () => {
      findUserWithRelationsMock.mockResolvedValue(null);

      await expect(service.update(99999, {} as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove — stub sin cambios (A11)', () => {
    it('devuelve el string fijo, sin tocar la base', () => {
      expect(service.remove(7)).toBe('This action removes a #7 user');
    });
  });
});
