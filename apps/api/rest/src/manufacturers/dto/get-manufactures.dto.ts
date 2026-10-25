import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';
import { Manufacturer } from '../entities/manufacturer.entity.js';

export class ManufacturerPaginator extends Paginator<Manufacturer> {
  data: Manufacturer[];
}

export class GetManufacturersDto extends PaginationArgs {
  orderBy?: QueryManufacturersOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
  language?: string;
}

export enum QueryManufacturersOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  NAME = 'NAME',
  UPDATED_AT = 'UPDATED_AT',
}
