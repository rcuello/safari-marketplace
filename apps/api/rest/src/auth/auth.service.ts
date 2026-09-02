import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  createUser,
  DuplicateEmailError,
  findUserCredentialsByEmail,
  findUserWithRelations,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  updateUserPasswordHash,
  type PermissionRecord,
  type ProfileRecord,
  type UserWithRelations,
} from '@safari/db';
import {
  AuthResponse,
  ChangePasswordDto,
  ForgetPasswordDto,
  LoginDto,
  CoreResponse,
  RegisterDto,
  ResetPasswordDto,
  VerifyForgetPasswordDto,
  SocialLoginDto,
  OtpLoginDto,
  OtpResponse,
  VerifyOtpDto,
  OtpDto,
} from './dto/create-auth.dto';
import { User } from 'src/users/entities/user.entity';
import { toShopDto } from 'src/shops/shops.service';

// Un solo mensaje para los tres casos que no deben distinguirse (D-4 del
// épico, extendido por el spec): contraseña mala, email inexistente,
// usuario inactivo. Diferenciar el texto sería en sí mismo una forma de
// enumeración de cuentas.
const INVALID_CREDENTIALS_MESSAGE = 'Las credenciales no son válidas.';

// Precedencia de `role` sobre `permissions[]` (Decisión F, design.md).
// Decorativa: ningún `hasAccess()` de los frontends la lee, pero el admin
// la guarda en cookie (`login-form.tsx:48`).
const ROLE_PRECEDENCE = ['super_admin', 'store_owner', 'staff', 'customer'] as const;

function deriveRole(permissions: string[]): string {
  return ROLE_PRECEDENCE.find((r) => permissions.includes(r)) ?? 'customer';
}

/**
 * `ProfileRecord` (camelCase) → shape Laravel. `id` y `customer_id` no
 * existen en la tabla (la PK real es `user_id`, US-20 Decisión D-4): se
 * sintetizan ambas = `userId` (V-5 del design). Clave preservada porque
 * `shop/src/pages/profile.tsx:26` lee `me.profile?.id!`.
 */
function toProfileDto(p: ProfileRecord) {
  return {
    id: p.userId,
    avatar: p.avatar,
    bio: p.bio,
    socials: p.socials,
    contact: p.contact,
    notifications: p.notifications,
    customer_id: p.userId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/**
 * `PermissionRecord` → shape Laravel con `pivot` sintetizado (V-3 del
 * design: `PermissionRecord` no modela `pivot`, no hay tabla intermedia
 * que serializar). `model_id` pasa de `6` fijo (Laravel) al id real del
 * usuario.
 */
function toPermissionDto(p: PermissionRecord, userId: number) {
  return {
    id: p.id,
    name: p.name,
    guard_name: p.guardName,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    pivot: {
      model_id: userId,
      permission_id: p.id,
      model_type: 'Marvel\\Database\\Models\\User',
    },
  };
}

/**
 * `UserWithRelations` → las 15 claves de `/me` (Decisión E, design.md), en
 * el mismo orden que publicaba `users.json`. `wallet`, `last_order` y
 * `address` son constantes (D-13/V-7): el mock traía un pedido completo y
 * dos direcciones para el usuario 3, pero no hay tablas que los respalden
 * todavía. `managed_shop` no se emite (V-11: el mock tampoco lo emitía).
 */
function toMeDto(record: UserWithRelations): User {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    email_verified_at: record.emailVerifiedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    is_active: Number(record.isActive),
    shop_id: null,
    email_verified: record.emailVerifiedAt !== null,
    profile: record.profile ? toProfileDto(record.profile) : null,
    permissions: record.permissions.map((p) => toPermissionDto(p, record.id)),
    wallet: null,
    shops: record.shops.map(toShopDto),
    last_order: null,
    address: [],
  } as unknown as User;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(loginInput: LoginDto): Promise<AuthResponse> {
    // Guarda R-5: `LoginDto` es `PartialType`, ambos campos son opcionales.
    // Sin esto, `bcryptjs.compare(undefined, hash)` lanza en vez de
    // devolver `false` — un body vacío sería un 500, no un 401.
    if (!loginInput.email || !loginInput.password) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const creds = await this.withPrismaErrorTranslation(() =>
      findUserCredentialsByEmail(loginInput.email),
    );
    if (!creds) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(
      loginInput.password,
      creds.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (!creds.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(creds.id),
    );
    const permissions = (record?.permissions ?? []).map((p) => p.name);
    const token = await this.jwtService.signAsync({
      sub: creds.id,
      email: creds.email,
      permissions,
    });

    return { token, permissions, role: deriveRole(permissions) };
  }

  async register(createUserInput: RegisterDto): Promise<AuthResponse> {
    // D-6: se ignora `createUserInput.permission` — aceptar un permiso del
    // body sería escalada de privilegios. El registro concede SIEMPRE
    // `customer`, sin importar qué mande el cliente.
    const passwordHash = await bcrypt.hash(createUserInput.password, 10);

    let user: { id: number; email: string };
    try {
      user = await createUser({
        name: createUserInput.name,
        email: createUserInput.email,
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

    const permissions = ['customer'];
    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      permissions,
    });

    // V-20: `role` se agrega a la respuesta de registro (el mock solo
    // devolvía `token`+`permissions`). Lo exige el spec.
    return { token, permissions, role: deriveRole(permissions) };
  }

  async changePassword(
    changePasswordInput: ChangePasswordDto,
    userEmail: string,
  ): Promise<CoreResponse> {
    const creds = await this.withPrismaErrorTranslation(() =>
      findUserCredentialsByEmail(userEmail),
    );

    const oldPasswordMatches =
      creds &&
      (await bcrypt.compare(
        changePasswordInput.oldPassword,
        creds.passwordHash,
      ));

    if (!oldPasswordMatches) {
      // CA-5: contraseña actual equivocada devuelve `CoreResponse` con
      // `success: false`, NUNCA una excepción — es el shape que el
      // formulario de la tienda ya traduce (`change-password-form.tsx`).
      return {
        success: false,
        message: 'PICKBAZAR_MESSAGE.OLD_PASSWORD_INCORRECT',
      };
    }

    const newPasswordHash = await bcrypt.hash(
      changePasswordInput.newPassword,
      10,
    );
    await this.withPrismaErrorTranslation(() =>
      updateUserPasswordHash(creds.id, newPasswordHash),
    );

    return { success: true, message: 'Password change successful' };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async forgetPassword(
    forgetPasswordInput: ForgetPasswordDto,
  ): Promise<CoreResponse> {
    console.log(forgetPasswordInput);

    return {
      success: true,
      message: 'Password change successful',
    };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async verifyForgetPasswordToken(
    verifyForgetPasswordTokenInput: VerifyForgetPasswordDto,
  ): Promise<CoreResponse> {
    console.log(verifyForgetPasswordTokenInput);

    return {
      success: true,
      message: 'Password change successful',
    };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async resetPassword(
    resetPasswordInput: ResetPasswordDto,
  ): Promise<CoreResponse> {
    console.log(resetPasswordInput);

    return {
      success: true,
      message: 'Password change successful',
    };
  }

  // Stub declarado por D-11 del épico: requiere credenciales OAuth externas. La
  // respuesta fija de abajo no cambia.
  async socialLogin(socialLoginDto: SocialLoginDto): Promise<AuthResponse> {
    console.log(socialLoginDto);
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async otpLogin(otpLoginDto: OtpLoginDto): Promise<AuthResponse> {
    console.log(otpLoginDto);
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async verifyOtpCode(verifyOtpInput: VerifyOtpDto): Promise<CoreResponse> {
    console.log(verifyOtpInput);
    return {
      message: 'success',
      success: true,
    };
  }

  // Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
  // respuesta fija de abajo no cambia — un stub silencioso es peor que uno
  // declarado.
  async sendOtpCode(otpInput: OtpDto): Promise<OtpResponse> {
    console.log(otpInput);
    return {
      message: 'success',
      success: true,
      id: '1',
      provider: 'google',
      phone_number: '+919494949494',
      is_contact_exist: true,
    };
  }

  async me(userId: number): Promise<User> {
    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(userId),
    );
    return toMeDto(record);
  }

  /**
   * Envoltura común (task 4.5): base caída → 503 legible; cualquier otro
   * error de Prisma → 500 legible. Mismo precedente que
   * `shops.service.ts` (`isPrismaConnectionError`/`getUserFriendlyMessage`).
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
