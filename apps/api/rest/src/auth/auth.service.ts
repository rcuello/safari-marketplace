import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import {
  consumeOtpCode,
  consumePasswordResetToken,
  createOtpCode,
  createPasswordResetToken,
  createUser,
  DuplicateEmailError,
  findLiveOtpCodeById,
  findLivePasswordResetTokens,
  findUserCredentialsByEmail,
  findUserIdByProfileContact,
  findUserWithRelations,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  updateUserPasswordHash,
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
import { resolveRecoveryOptions } from './recovery-options';
import { User } from 'src/users/entities/user.entity';
import { toUserDto } from 'src/users/user-dto.mapper';

// Un solo mensaje para los tres casos que no deben distinguirse (D-4 del
// épico, extendido por el spec): contraseña mala, email inexistente,
// usuario inactivo. Diferenciar el texto sería en sí mismo una forma de
// enumeración de cuentas.
const INVALID_CREDENTIALS_MESSAGE = 'Las credenciales no son válidas.';

// Literal heredado del mock (CA-2/CA-6): una sola constante para que las dos
// ramas de `forgetPassword` (email existente / inexistente) construyan el
// mismo cuerpo desde la misma fuente, nunca desde dos literales que puedan
// divergir al editarse.
const PASSWORD_CHANGE_SUCCESS_MESSAGE = 'Password change successful';

// D6/CA-6: mensaje de fallo de dominio para token/código inválido, vencido
// o ya consumido — la misma clave para las tres causas (no se distinguen).
const INVALID_TOKEN_MESSAGE = 'PICKBAZAR_MESSAGE.INVALID_TOKEN';

// Precedencia de `role` sobre `permissions[]` (Decisión F, design.md).
// Decorativa: ningún `hasAccess()` de los frontends la lee, pero el admin
// la guarda en cookie (`login-form.tsx:48`).
const ROLE_PRECEDENCE = ['super_admin', 'store_owner', 'staff', 'customer'] as const;

function deriveRole(permissions: string[]): string {
  return ROLE_PRECEDENCE.find((r) => permissions.includes(r)) ?? 'customer';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

  /**
   * CA-1/CA-2: email existente genera y persiste un token de recuperación
   * hasheado; email inexistente responde EXACTAMENTE igual, sin fila ni
   * log (D-4 del épico, sin enumeración de cuentas). La latencia difiere
   * (Decisión E, design.md) — declarado, no mitigado (V-3).
   */
  async forgetPassword(
    forgetPasswordInput: ForgetPasswordDto,
  ): Promise<CoreResponse> {
    const creds = await this.withPrismaErrorTranslation(() =>
      findUserCredentialsByEmail(forgetPasswordInput.email),
    );
    if (!creds) {
      return { success: true, message: PASSWORD_CHANGE_SUCCESS_MESSAGE };
    }

    const { passwordResetTtlMinutes } = resolveRecoveryOptions();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const expiresAt = new Date(Date.now() + passwordResetTtlMinutes * 60_000);

    await this.withPrismaErrorTranslation(() =>
      createPasswordResetToken({ userId: creds.id, tokenHash, expiresAt }),
    );

    // D5: advertencia de "sin envío real" en la MISMA emisión que el secreto.
    this.logger.warn(
      `[forget-password] Implementación de desarrollo, SIN envío real de correo. ` +
        `Token en claro para ${forgetPasswordInput.email}: ${token} (expira ${expiresAt.toISOString()})`,
    );

    return { success: true, message: PASSWORD_CHANGE_SUCCESS_MESSAGE };
  }

  /**
   * CA-3: `success:true` solo si, para el usuario resuelto del email, existe
   * un token vivo (no vencido, no consumido) cuyo hash coincide. NO consume
   * — repetible. Bucle secuencial con corte en la primera coincidencia
   * (Decisión C/D, design.md): nunca `Promise.all`, acota el coste bcrypt.
   */
  async verifyForgetPasswordToken(
    verifyForgetPasswordTokenInput: VerifyForgetPasswordDto,
  ): Promise<CoreResponse> {
    if (!verifyForgetPasswordTokenInput.token) {
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const creds = await this.withPrismaErrorTranslation(() =>
      findUserCredentialsByEmail(verifyForgetPasswordTokenInput.email),
    );
    if (!creds) {
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const liveTokens = await this.withPrismaErrorTranslation(() =>
      findLivePasswordResetTokens(creds.id),
    );
    for (const row of liveTokens) {
      if (await bcrypt.compare(verifyForgetPasswordTokenInput.token, row.tokenHash)) {
        return { success: true, message: PASSWORD_CHANGE_SUCCESS_MESSAGE };
      }
    }

    return { success: false, message: INVALID_TOKEN_MESSAGE };
  }

  /**
   * CA-4: mismo bucle de comparación que `verifyForgetPasswordToken`. La
   * primera coincidencia se consume con un UPDATE condicional ANTES de
   * cambiar el hash — si el cambio de hash fallara después, el token queda
   * quemado y el usuario pide otro (falla en la dirección segura).
   */
  async resetPassword(
    resetPasswordInput: ResetPasswordDto,
  ): Promise<CoreResponse> {
    if (!resetPasswordInput.token || !resetPasswordInput.password) {
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const creds = await this.withPrismaErrorTranslation(() =>
      findUserCredentialsByEmail(resetPasswordInput.email),
    );
    if (!creds || !creds.isActive) {
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const liveTokens = await this.withPrismaErrorTranslation(() =>
      findLivePasswordResetTokens(creds.id),
    );
    let matchedId: number | undefined;
    for (const row of liveTokens) {
      if (await bcrypt.compare(resetPasswordInput.token, row.tokenHash)) {
        matchedId = row.id;
        break;
      }
    }
    if (matchedId === undefined) {
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const consumedCount = await this.withPrismaErrorTranslation(() =>
      consumePasswordResetToken(matchedId as number),
    );
    if (consumedCount === 0) {
      // Carrera perdida / reintento con un token ya consumido por otra
      // petición concurrente.
      return { success: false, message: INVALID_TOKEN_MESSAGE };
    }

    const newPasswordHash = await bcrypt.hash(resetPasswordInput.password, 10);
    await this.withPrismaErrorTranslation(() =>
      updateUserPasswordHash(creds.id, newPasswordHash),
    );

    return { success: true, message: PASSWORD_CHANGE_SUCCESS_MESSAGE };
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

  /**
   * D2: la identidad se resuelve SOLO por `phone_number` vía
   * `findUserIdByProfileContact` — `name`/`email` del body se ignoran a
   * propósito y NUNCA crea cuentas. D6: toda causa de fallo (código
   * inválido, teléfono no coincidente, teléfono ambiguo/sin perfil, usuario
   * inactivo, o carrera perdida al consumir) lanza el MISMO
   * `UnauthorizedException` genérico de `login()` — nunca `CoreResponse`.
   * Consume el código ANTES de firmar (dos peticiones concurrentes con el
   * mismo código no pueden llevarse dos JWT).
   */
  async otpLogin(otpLoginDto: OtpLoginDto): Promise<AuthResponse> {
    const otpId = Number(otpLoginDto.otp_id);
    if (!Number.isSafeInteger(otpId) || otpId <= 0 || !otpLoginDto.code) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const row = await this.withPrismaErrorTranslation(() =>
      findLiveOtpCodeById(otpId),
    );
    if (
      !row ||
      row.phone !== otpLoginDto.phone_number ||
      !(await bcrypt.compare(otpLoginDto.code, row.codeHash))
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const userId = await this.withPrismaErrorTranslation(() =>
      findUserIdByProfileContact(otpLoginDto.phone_number),
    );
    if (userId === null) {
      // 0 ó >1 perfiles con ese teléfono (ambiguo) — misma respuesta genérica.
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(userId),
    );
    if (!record || !record.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const consumedCount = await this.withPrismaErrorTranslation(() =>
      consumeOtpCode(row.id),
    );
    if (consumedCount === 0) {
      // Carrera perdida / reintento con un código ya consumido.
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const permissions = record.permissions.map((p) => p.name);
    const token = await this.jwtService.signAsync({
      sub: record.id,
      email: record.email,
      permissions,
    });

    return { token, permissions, role: deriveRole(permissions) };
  }

  /**
   * CA-5: `success:true` solo si `otp_id` corresponde a una fila viva cuyo
   * `phone` coincide con `phone_number` y cuyo código coincide. NO consume
   * — repetible.
   */
  async verifyOtpCode(verifyOtpInput: VerifyOtpDto): Promise<CoreResponse> {
    const otpId = Number(verifyOtpInput.otp_id);
    if (!Number.isSafeInteger(otpId) || otpId <= 0 || !verifyOtpInput.code) {
      return { message: INVALID_TOKEN_MESSAGE, success: false };
    }

    const row = await this.withPrismaErrorTranslation(() =>
      findLiveOtpCodeById(otpId),
    );
    if (
      !row ||
      row.phone !== verifyOtpInput.phone_number ||
      !(await bcrypt.compare(verifyOtpInput.code, row.codeHash))
    ) {
      return { message: INVALID_TOKEN_MESSAGE, success: false };
    }

    return { message: 'success', success: true };
  }

  /**
   * CA-5: genera un código de 6 dígitos (admite ceros a la izquierda, V-5),
   * lo persiste hasheado con vencimiento y lo emite al log (D5). Un
   * `phone_number` vacío es fallo de dominio, no infraestructura.
   */
  async sendOtpCode(otpInput: OtpDto): Promise<OtpResponse> {
    if (!otpInput.phone_number) {
      return {
        message: 'PICKBAZAR_MESSAGE.REQUIRED_INFO_MISSING',
        success: false,
        id: '',
        provider: 'log',
        phone_number: '',
        is_contact_exist: false,
      };
    }

    const { otpCodeTtlMinutes } = resolveRecoveryOptions();
    // V-5: `padStart` preserva ceros a la izquierda — `randomInt(100000,1e6)`
    // perdería el 10% del espacio de códigos.
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + otpCodeTtlMinutes * 60_000);

    const row = await this.withPrismaErrorTranslation(() =>
      createOtpCode({ phone: otpInput.phone_number, codeHash, expiresAt }),
    );
    const isContactExist =
      (await this.withPrismaErrorTranslation(() =>
        findUserIdByProfileContact(otpInput.phone_number),
      )) !== null;

    // D5: advertencia de "sin envío real" en la MISMA emisión que el secreto.
    this.logger.warn(
      `[send-otp-code] Implementación de desarrollo, SIN envío real de SMS. ` +
        `Código en claro para ${otpInput.phone_number}: ${code} (expira ${expiresAt.toISOString()})`,
    );

    return {
      message: 'success',
      success: true,
      id: String(row.id),
      provider: 'log',
      phone_number: otpInput.phone_number,
      is_contact_exist: isContactExist,
    };
  }

  async me(userId: number): Promise<User> {
    const record = await this.withPrismaErrorTranslation(() =>
      findUserWithRelations(userId),
    );
    return toUserDto(record);
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
