import { SortOrder } from 'src/common/dto/generic-conditions.dto';

export class GetShippingsDto {
  text?: string;
  /** `name:<término>` desde el admin (`shippingClient.all`). */
  search?: string;
  orderBy?: QueryShippingClassesOrderByColumn;
  sortedBy?: SortOrder;
}

export enum QueryShippingClassesOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  UPDATED_AT = 'UPDATED_AT',
  NAME = 'NAME',
  AMOUNT = 'AMOUNT',
  IS_GLOBAL = 'IS_GLOBAL',
  TYPE = 'TYPE',
}
