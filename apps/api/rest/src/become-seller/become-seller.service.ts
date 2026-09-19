import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  getBecomeSeller,
  updateBecomeSeller,
  type BecomeSellerRecord,
  type Prisma,
} from '@safari/db';
import {
  BecomeSeller,
  BecomeSellerOptions,
  CommissionItem,
} from './entities/become-seller.entity';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import { UpdateBecomeSellerDto } from './dto/update-become-seller.dto';

/**
 * `@safari/db` guarda `pageOptions`/`commissions` como `Prisma.JsonValue` y
 * acepta `Prisma.InputJsonValue` (`packages/db/src/records.ts:187-194`,
 * `become-seller.repository.ts:19-24`): ninguna clase es asignable a esos
 * tipos en ninguna dirección — a una clase le falta el índice de `string`
 * que `InputJsonObject` exige, y un `{...spread}` falla un nivel más abajo
 * (`banner` vuelve a ser clase). Este límite es lo que obligaba antes a un
 * salto de tipos vía `unknown` para cruzarlo.
 *
 * Las dos guardas de abajo cruzan ese límite con una comprobación real de
 * runtime (`typeof`/`Array.isArray`) y **una sola** condición por campo,
 * compartida por lectura y escritura: el predicado estrecha a la
 * intersección `<Clase> & Prisma.InputJson{Object,Array}`, así que el
 * mismo valor narrowed sirve para construir el literal tipado de
 * `_toEnvelope()` (lado clase) y para pasarse tal cual a
 * `updateBecomeSeller()` (lado `Prisma.InputJsonValue`) sin ningún escape
 * de tipos. Antes de esta corrección, `create()` usaba una guarda más laxa
 * (cualquier objeto u array) que la de `_toEnvelope()` (objeto exacto /
 * array exacto por campo): un `POST` con `commissions` como objeto (o
 * `page_options` como array) pasaba la guarda de escritura, se persistía,
 * y la siguiente lectura reventaba en la guarda de `_toEnvelope()` — 500
 * permanente en una ruta `@Public()`. Con una única condición por campo,
 * eso ya no puede ocurrir: solo se escribe lo que la lectura acepta.
 */
function _isBecomeSellerOptions(
  value: unknown,
): value is BecomeSellerOptions & Prisma.InputJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function _isCommissionList(
  value: unknown,
): value is CommissionItem[] & Prisma.InputJsonArray {
  return Array.isArray(value);
}

/**
 * SEGUNDO endpoint migrado del mock JSON a Postgres (US-44, tras `settings`
 * en US-32). Contrato HTTP intacto: `POST|GET /api/became-seller`
 * (pasado), `@Public()` sin guard (`become-seller.controller.ts`).
 *
 * El envoltorio `{ page_options: { id, page_options, language, created_at,
 * updated_at }, commissions }` se recompone AQUÍ, en el servicio — así lo
 * manda el comentario de `db/schema.sql:479-484` — porque la capa de datos
 * (`@safari/db`) devuelve camelCase y la API sigue publicando snake_case
 * (`config.yaml`). El literal de orden fijo hace que el orden de claves del
 * cuerpo coincida con el del mock por construcción (D-2).
 */
@Injectable()
export class BecomeSellerService {
  async findAll(): Promise<BecomeSeller> {
    const row = await getBecomeSeller();
    return this._toEnvelope(row);
  }

  async create(createBecomeSellerDto: CreateBecomeSellerDto): Promise<BecomeSeller> {
    const { page_options, commissions, language } = createBecomeSellerDto;
    const row = await updateBecomeSeller({
      ...(_isBecomeSellerOptions(page_options) && { pageOptions: page_options }),
      ...(_isCommissionList(commissions) && { commissions: commissions }),
      ...(language !== undefined && { language }),
    });
    return this._toEnvelope(row);
  }

  // El controller no cablea esta ruta (`become-seller.controller.ts:13-21`);
  // se conserva por si un consumidor futuro la agrega — calco exacto de
  // `settings.service.ts:49-59` (D-6).
  update(_id: number, _updateBecomeSellerDto: UpdateBecomeSellerDto) {
    return this.findAll();
  }

  findOne(id: number) {
    return `This action returns a #${id} setting`;
  }

  remove(id: number) {
    return `This action removes a #${id} Become Seller`;
  }

  // Guarda única para las dos rutas de escritura/lectura (mensaje calco de
  // `settings.service.ts:28-30`): la base existe pero puede no estar
  // sembrada, y devolver `null` rompería al shop en el primer render sin
  // ninguna pista.
  private _toEnvelope(row: BecomeSellerRecord | null): BecomeSeller {
    if (!row) {
      throw new InternalServerErrorException(
        'No hay fila en `become_seller`. Siembra la base con `just db-migrate`.',
      );
    }
    if (!_isBecomeSellerOptions(row.pageOptions) || !_isCommissionList(row.commissions)) {
      throw new InternalServerErrorException(
        'La fila de `become_seller` tiene `page_options`/`commissions` con forma inesperada.',
      );
    }

    return {
      page_options: {
        id: row.id,
        page_options: row.pageOptions,
        language: row.language,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
      commissions: row.commissions,
    };
  }
}
