import { Controller, Post, Body } from '@nestjs/common';
import { ImportsService } from './imports.service.js';
import { ImportDto } from './dto/create-import.dto.js';
import {
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Permissions(...ADMIN_ONLY)
@Controller()
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('import-attributes')
  importAttributes(@Body() importAttributesDto: ImportDto) {
    console.log(importAttributesDto);
    return true;
  }
  @Post('import-products')
  importProducts(@Body() importProductsDto: ImportDto) {
    console.log(importProductsDto);
    return true;
  }
  @Post('import-variation-options')
  importVariationOptions(@Body() importVariationOptionsDto: ImportDto) {
    console.log(importVariationOptionsDto);
    return true;
  }
}
