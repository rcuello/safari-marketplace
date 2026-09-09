import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  buildPaginator,
  createUser,
  DuplicateEmailError,
  findUserWithRelations,
  getUserFriendlyMessage,
  grantPermission,
  isPrismaConnectionError,
  listUsers,
  listUsersWithRelations,
  setUserActive,
  type UserWithRelations,
} from '@safari/db';
import type { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { APP_URL } from 'src/common/constants';
import { parseSearch } from 'src/common/search/parse-search';
import { CreateUserDto } from './dto/create-user.dto';
import { GetUsersDto, UserPaginator } from './dto/get-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { toUserDto } from './user-dto.mapper';

/**
 * US-25: `UsersService` deja de mantener `this.users` en memoria y pasa a
 * llamar funciones planas de `@safari/db` (D-1 del design). Sigue SIN
 * dependencias de constructor (D-E): `StoreNoticesModule` instancia un
 * segundo `UsersService` sin importar `UsersModule`
 * (`store-notices.module.ts:8`) — un `constructor(private readonly …)` aquí
 * rompería el arranque de Nest.
 */
@Injectable()
export class UsersService {
  /**
   * Crea el usuario (`createUser`, bcrypt costo 10) con permiso `customer`
   * fijo (V-8/D-D): `permission`/`profile`/`address` del DTO se ignoran —
   * aceptar un permiso del body sería escalada de privilegios. `createUser`
   * devuelve `UserRecord` (sin relaciones); se lee de nuevo con
   * `findUserWithRelations` para que `toUserDto` publique las 15 claves
   * (D-D: asimetría declarada, ya embarcada por `auth.service.register`).
   */
  async create(createUserDto: CreateUserDto): Promise<User> {
    const passwordHash = await bcrypt.hash(createUserDto.password, 10);

    let created: { id: number };
    try {
      created = await createUser({
        name: createUserDto.name,
        email: createUserDto.email,
        passwordHash,
        permissionNames: ['customer'],
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException(error.message);
      }
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(created.id),
    );
    return toUserDto(record as UserWithRelations);
  }

  async getUsers(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/users');
  }

  /**
   * D-B guarda #2: sin envoltorio de paginación no hay triple camino de
   * `page`/`limit` — `?limit=5` crudo llegaría a Prisma como `take: "5"` y
   * lanzaría. `getUsersNotify` pasa a `async`; Nest resuelve la promesa que
   * devuelve el handler de `store-notices.controller.ts` sin tocarlo (D-E).
   */
  async getUsersNotify({ limit }: GetUsersDto): Promise<User[]> {
    const result = await this.withPrismaErrorTranslation(() =>
      listUsersWithRelations({ page: 1, limit: Number(limit) || 30 }),
    );
    return result.items.map(toUserDto);
  }

  async findOne(id: number): Promise<User> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException('El identificador de usuario no es válido.');
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(id),
    );
    if (!record) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    return toUserDto(record);
  }

  /**
   * Stub declarado (A11): lee y devuelve el usuario vía `findUserWithRelations`
   * (404 si no existe), sin persistir ningún campo de `updateUserDto`.
   */
  async update(id: number, _updateUserDto: UpdateUserDto): Promise<User> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException('El identificador de usuario no es válido.');
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(id),
    );
    if (!record) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    return toUserDto(record);
  }

  remove(id: number): string {
    return `This action removes a #${id} user`;
  }

  /**
   * D-B guarda #4: `MakeAdminInput.user_id` es `string`
   * (`apps/admin/rest/src/types/index.ts:442-444`) — se convierte y valida
   * ANTES de llamar al repositorio. D-5: el permiso concedido aquí NO
   * afecta al guard hasta el siguiente login del usuario promovido — el
   * guard lee permisos del JWT, nunca consulta la base
   * (`permissions.guard.ts:18-26`). No se añade un lookup nuevo para
   * disimular el retardo.
   */
  async makeAdmin(userId: string): Promise<User> {
    const id = Number(userId);
    if (!Number.isInteger(id)) {
      throw new NotFoundException('El identificador de usuario no es válido.');
    }

    const record = await this.withPrismaErrorTranslation(() =>
      grantPermission(id, 'super_admin'),
    );
    if (!record) {
      throw new NotFoundException(`No existe un usuario con id ${userId}.`);
    }

    return toUserDto(record);
  }

  /**
   * `block-user`: fija `is_active: false` explícitamente (`setUserActive`,
   * sin invertir — dos llamadas seguidas dejan al usuario bloqueado). 409 si
   * el actor se bloquea a sí mismo o si el objetivo es el único
   * `super_admin` (conteo SIN filtrar `isActive` — conservador a propósito,
   * D-F). El `findUserWithRelations` previo sirve dos propósitos: el 404 y
   * las relaciones que necesita `toUserDto`.
   */
  async banUser(id: number, currentUser: CurrentUserPayload): Promise<User> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException('El identificador de usuario no es válido.');
    }

    if (currentUser.sub === id) {
      throw new ConflictException('No puedes bloquearte a ti mismo.');
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(id),
    );
    if (!record) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    const targetIsSuperAdmin = record.permissions.some(
      (p) => p.name === 'super_admin',
    );
    if (targetIsSuperAdmin) {
      const { total } = await this.withPrismaErrorTranslation(() =>
        listUsers({ permissionName: 'super_admin' }),
      );
      if (total <= 1) {
        throw new ConflictException(
          'No puedes bloquear al único usuario con permiso super_admin.',
        );
      }
    }

    const updated = await this.withPrismaErrorTranslation(() =>
      setUserActive(id, false),
    );
    if (!updated) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    return toUserDto({ ...record, ...updated } as UserWithRelations);
  }

  /**
   * `unblock-user`: fija `is_active: true` explícitamente. Sin guardas de
   * negocio (reactivar nunca deja el panel sin admin) pero SÍ lee
   * `findUserWithRelations` antes de escribir — necesita las relaciones
   * para el DTO de 15 claves y el 404 (D-F).
   */
  async activeUser(id: number): Promise<User> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException('El identificador de usuario no es válido.');
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(id),
    );
    if (!record) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    const updated = await this.withPrismaErrorTranslation(() =>
      setUserActive(id, true),
    );
    if (!updated) {
      throw new NotFoundException(`No existe un usuario con id ${id}.`);
    }

    return toUserDto({ ...record, ...updated } as UserWithRelations);
  }

  async getAdmin(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/admin/list', 'super_admin');
  }

  async getVendors(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/vendors/list', 'store_owner');
  }

  async getAllCustomers(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/customers/list', 'customer');
  }

  /**
   * Alias declarado de `getAllStaffs` (A2/V-7): sin tabla staff↔tienda, la
   * única relación disponible es `shops.owner_id`, así que ambos filtran el
   * mismo permiso `staff`. Cada uno conserva su propia `url` en el
   * envoltorio.
   */
  async getMyStaffs(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/my-staffs/list', 'staff');
  }

  async getAllStaffs(query: GetUsersDto): Promise<UserPaginator> {
    return this._listByPermission(query, '/all-staffs/list', 'staff');
  }

  /**
   * Base de los 6 listados (A1). D-B — CRÍTICO: `page`/`limit` viajan por
   * TRES caminos distintos:
   *  - al repositorio: `Number(page)||1` / `Number(limit)||30` (Prisma
   *    lanza con `NaN`/string en `skip`/`take`).
   *  - a `buildPaginator({ page })`: numérico (el mock coerce con
   *    `+current_page`; `buildPaginator` no coerce).
   *  - a `buildPaginator({ limit, baseUrl })`: CRUDO, tras el default de
   *    abajo — reproduce `per_page: "20"` string, igual que las otras 36
   *    llamadas a `paginate()` de la API con `new ValidationPipe()` sin
   *    `transform` (`main.ts:9`).
   * Sin `baseUrl` las 4 `*_page_url` saldrían `null` en vez de string.
   */
  private async _listByPermission(
    { text, limit, page, search }: GetUsersDto,
    url: string,
    permissionName?: string,
  ): Promise<UserPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;

    const tokens = parseSearch(search);
    const resolvedText = text ?? tokens.name;

    const result = await this.withPrismaErrorTranslation(() =>
      listUsersWithRelations({
        page: Number(page) || 1,
        limit: Number(limit) || 30,
        text: resolvedText,
        permissionName,
      }),
    );

    const data = result.items.map(toUserDto);
    const baseUrl = `${APP_URL}${url}?limit=${limit}`;

    return buildPaginator({
      data,
      total: result.total,
      page: Number(page) || 1,
      limit,
      baseUrl,
    }) as unknown as UserPaginator;
  }

  /**
   * Envoltura común (precedente `auth.service.ts`/`shops.service.ts`): base
   * caída → 503 legible; cualquier otro error de Prisma → 500 legible.
   */
  private async withPrismaErrorTranslation<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }
}
