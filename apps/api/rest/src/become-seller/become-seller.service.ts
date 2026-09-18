import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  getBecomeSeller,
  updateBecomeSeller,
  type BecomeSellerRecord,
  type Prisma,
} from '@safari/db';
import { BecomeSeller } from './entities/become-seller.entity';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import { UpdateBecomeSellerDto } from './dto/update-become-seller.dto';

/**
 * El body real que manda el admin (`BecomeSellerInput`,
 * `apps/admin/rest/src/types/index.ts:2242-2246`), armado como objeto plano
 * en `become-seller-form.tsx:81-96` y enviado por `POST` en
 * `data/client/become-seller.ts:19-23`. **No** es `BecomeSeller` (la
 * entidad de este módulo): esa declara `missions` (no `commissions`) y
 * anida `page_options` un nivel más
 * (`entities/become-seller.entity.ts:6-10`), así que `dto.commissions` no
 * compila (D-4, `design.md`). `CreateBecomeSellerDto` se reinterpreta con
 * `as unknown as` — mismo recurso que `settings.service.ts:39`
 * (`as unknown as Setting`).
 */
interface BecomeSellerWriteBody {
  language?: string;
  page_options: Prisma.InputJsonValue;
  commissions: Prisma.InputJsonValue;
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
    const body = createBecomeSellerDto as unknown as BecomeSellerWriteBody;
    const row = await updateBecomeSeller({
      ...(body.page_options !== undefined && { pageOptions: body.page_options }),
      ...(body.commissions !== undefined && { commissions: body.commissions }),
      ...(body.language !== undefined && { language: body.language }),
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

    return {
      page_options: {
        id: row.id,
        page_options: row.pageOptions,
        language: row.language,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
      commissions: row.commissions,
    } as unknown as BecomeSeller;
  }
}
