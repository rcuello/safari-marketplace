import { SortOrder } from 'src/common/dto/generic-conditions.dto';

export class GetTaxesDto {
  text?: string;
  /** `name:<término>` desde la página `/taxes` del admin (`taxClient.all`). */
  search?: string;
  orderBy?: QueryTaxClassesOrderByColumn;
  sortedBy?: SortOrder;
}

export enum QueryTaxClassesOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  UPDATED_AT = 'UPDATED_AT',
  NAME = 'NAME',
  RATE = 'RATE',
  COUNTRY = 'COUNTRY',
  STATE = 'STATE',
}
