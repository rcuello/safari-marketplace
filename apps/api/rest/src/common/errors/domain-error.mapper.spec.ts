/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de `domain-error.mapper.ts` (US-27a, spec
 * `catalog-write-foundations`).
 *
 * Los cinco códigos de catálogo se prueban DIRECTAMENTE aquí, no por HTTP:
 * `types` solo puede producir `EmptySlug`/`RecordNotFound`/`DependentRows`
 * en esta US (`InvalidReference` necesita una FK saliente que `types` no
 * tiene; `SlugConflict` solo aparece en una carrera no determinista). Esa
 * cobertura completa es lo que hace alcanzable la CA-7 de US-27b.
 *
 * Sin `jest.mock`: se importa el barrel real de `@safari/db` (seguro de
 * cargar sin `DATABASE_URL` por el cliente lazy vía Proxy, `client.ts:39-45`)
 * y las 5 clases de error se construyen de verdad. Los errores "de Prisma"
 * de este spec se construyen ESTRUCTURALMENTE (`name`/`code`/`message`), no
 * con `new PrismaClientKnownRequestError`: D-1 prohíbe importar
 * `@prisma/client` en la API, y los predicados del mapeador (y de
 * `errors.ts`) son estructurales, así que la fixture es fiel.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DependentRowsError,
  EmptySlugError,
  InvalidReferenceError,
  isPrismaConnectionError,
  RecordNotFoundError,
  SlugConflictError,
} from '@safari/db';
import { mapDomainError, toWriteHttpException } from './domain-error.mapper';

describe('mapDomainError — tabla cerrada de 5 códigos (CA-4, CA-7)', () => {
  it('EmptySlug → 400', () => {
    const result = mapDomainError(new EmptySlugError('types', '!!!'));

    expect(result).toBeInstanceOf(BadRequestException);
    expect(result?.getStatus()).toBe(400);
  });

  it('InvalidReference → 400 (sin productor en `types`, pero probado directo)', () => {
    const result = mapDomainError(
      new InvalidReferenceError('tags', 'type_id', 99999),
    );

    expect(result).toBeInstanceOf(BadRequestException);
    expect(result?.getStatus()).toBe(400);
  });

  it('RecordNotFound → 404', () => {
    const result = mapDomainError(new RecordNotFoundError('types', 99999));

    expect(result).toBeInstanceOf(NotFoundException);
    expect(result?.getStatus()).toBe(404);
  });

  it('DependentRows → 409', () => {
    const result = mapDomainError(
      new DependentRowsError('types', { categories: 10, products: 44 }),
    );

    expect(result).toBeInstanceOf(ConflictException);
    expect(result?.getStatus()).toBe(409);
  });

  it('SlugConflict → 409 (solo alcanzable por carrera, pero probado directo)', () => {
    const result = mapDomainError(new SlugConflictError('types', 'gadget-2'));

    expect(result).toBeInstanceOf(ConflictException);
    expect(result?.getStatus()).toBe(409);
  });

  it('un error que no es de catálogo devuelve null (deja la cadena seguir)', () => {
    expect(mapDomainError(new Error('no es de dominio'))).toBeNull();
  });
});

describe('toWriteHttpException — cadena de fallback corregida (B1)', () => {
  it('un error de dominio pasa por mapDomainError, nunca llega a 500/503', () => {
    const result = toWriteHttpException(new RecordNotFoundError('types', 1));

    expect(result).toBeInstanceOf(NotFoundException);
    expect(result.getStatus()).toBe(404);
  });

  it('{code: "P1001"} (fallo de arranque de Prisma) → 503', () => {
    const result = toWriteHttpException({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect(result).toBeInstanceOf(ServiceUnavailableException);
    expect(result.getStatus()).toBe(503);
    expect(result.message).toBe(
      'No se puede conectar con el servicio. Por favor, intenta más tarde.',
    );
  });

  it('{name: "PrismaClientInitializationError"} → 503', () => {
    const result = toWriteHttpException({
      name: 'PrismaClientInitializationError',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect(result).toBeInstanceOf(ServiceUnavailableException);
    expect(result.getStatus()).toBe(503);
  });

  /**
   * Hallazgo C-1 de `sdd-verify`. Esta fixture NO es sintética: es la forma
   * EXACTA que Prisma 7 + `@prisma/adapter-pg` produce con el contenedor
   * `safari-postgres` apagado, capturada apagándolo de verdad. Importa porque
   * ni el `code` es un `P1xxx` ni el `message` contiene ninguno de los
   * patrones de conexión — con la versión anterior de `isConnectionFailure`
   * este error caía al 500 literal y la rama 503 estaba muerta en las tres
   * rutas de escritura, mientras las de lectura (con la cadena vieja) sí
   * devolvían 503 en la misma ventana.
   */
  it('base caída real (ECONNREFUSED en `code`, no en `message`) → 503 — C-1', () => {
    const result = toWriteHttpException({
      name: 'PrismaClientKnownRequestError',
      code: 'ECONNREFUSED',
      message: '\nInvalid `prisma.$queryRaw()` invocation:\n\n\n',
    });

    expect(result).toBeInstanceOf(ServiceUnavailableException);
    expect(result.getStatus()).toBe(503);
  });

  /**
   * Regression tripwire de B1: un `PrismaClientKnownRequestError` con
   * `code: 'P2011'` (violación NOT NULL, ninguno de los 5 códigos de
   * catálogo) MUST caer al 500 literal, NO al 503 — porque no es un fallo de
   * conexión, es un dato inválido. La caracterización de abajo prueba que
   * `isPrismaConnectionError` (el helper viejo de `errors.ts`, NO el
   * `isConnectionFailure` privado de este mapeador) se equivoca con el MISMO
   * objeto: si algún día `toWriteHttpException` se reescribiera para
   * delegar en ese helper, este test lo atraparía.
   */
  it('un error con forma de Prisma pero código P2011 → 500 (NO 503) — B1', () => {
    const prismaShapedError = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    };

    // Caracterización: el helper viejo SÍ se equivoca con este objeto.
    expect(isPrismaConnectionError(prismaShapedError)).toBe(true);

    // El mapeador nuevo NO hereda ese defecto.
    const result = toWriteHttpException(prismaShapedError);

    expect(result).toBeInstanceOf(InternalServerErrorException);
    expect(result.getStatus()).toBe(500);
    expect(result.message).toBe(
      'Ocurrió un error inesperado. Por favor, contacta al administrador.',
    );
  });

  it("new Error('x') → 500 con el mensaje literal fijo", () => {
    const result = toWriteHttpException(new Error('x'));

    expect(result).toBeInstanceOf(InternalServerErrorException);
    expect(result.getStatus()).toBe(500);
    expect(result.message).toBe(
      'Ocurrió un error inesperado. Por favor, contacta al administrador.',
    );
  });
});
