import { getSettings } from '@safari/db';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { Setting } from './entities/setting.entity';

/**
 * PRIMER endpoint migrado del mock JSON a Postgres.
 *
 * Se eligió `settings` como cabeza de puente porque es lo más pequeño que hay
 * (una fila, sin relaciones, sin paginación) y a la vez la PRIMERA llamada que
 * hace la tienda en cada render: si algo falla en la fontanería —cadena de
 * build, DATABASE_URL, resolución del paquete— se nota de inmediato y el error
 * no se puede confundir con un fallo de la consulta.
 *
 * El contrato HTTP no cambia. La capa de datos devuelve camelCase (convención
 * de Prisma) y la API sigue publicando snake_case (convención de Laravel, que
 * es lo que el frontend ya consume), así que la traducción se hace aquí.
 */
@Injectable()
export class SettingsService {
  async findAll(): Promise<Setting> {
    const row = await getSettings();
    if (!row) {
      // La base existe pero no está sembrada. Fallar con un mensaje claro es
      // mejor que devolver null: el shop rompe en el primer render sin pistas
      // si no encuentra `options`.
      throw new InternalServerErrorException(
        'No hay fila en `settings`. Siembra la base con `just db-migrate`.',
      );
    }

    return {
      id: row.id,
      options: row.options,
      language: row.language,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    } as unknown as Setting;
  }

  // Escrituras: el mock nunca persistió nada (devolvía el objeto tal cual).
  // Se mantiene ese comportamiento en vez de implementar a medias algo que
  // ningún consumidor usa todavía.
  create(_createSettingDto: CreateSettingDto) {
    return this.findAll();
  }

  update(_id: number, _updateSettingDto: UpdateSettingDto) {
    return this.findAll();
  }

  findOne(id: number) {
    return `This action returns a #${id} setting`;
  }

  remove(id: number) {
    return `This action removes a #${id} setting`;
  }
}
