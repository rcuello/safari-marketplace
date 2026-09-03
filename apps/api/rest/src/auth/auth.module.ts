import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { resolveJwtOptions } from './jwt-options';

@Module({
  // registerAsync + useFactory (Decisión A, design.md): el fail-fast de
  // `resolveJwtOptions()` corre cuando Nest instancia este provider, DESPUÉS
  // de que `.env` esté en `process.env`. `register({...})` leería
  // `process.env.JWT_SECRET` al evaluar este módulo, antes de
  // `ConfigModule.forRoot()` — siempre `undefined`.
  imports: [JwtModule.registerAsync({ useFactory: resolveJwtOptions })],
  controllers: [AuthController],
  providers: [AuthService],
  // JwtModule también se exporta (Decisión A, design.md): los guards
  // globales de la Fase 3 se instancian en el contexto de AppModule, y
  // JwtAuthGuard inyecta JwtService. Sin este export, el arranque falla con
  // "Nest can't resolve dependencies of JwtAuthGuard (?, Reflector)".
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
