import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GetAnalyticsListDto } from './dto/get-analytics-list.dto';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Permissions(...ADMIN_ONLY)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  analytics() {
    return this.analyticsService.findAll();
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('category-wise-product')
export class CategoryWiseProductController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  analytics(@Query() query: GetAnalyticsListDto) {
    return this.analyticsService.findAllCategoryWiseProduct(query);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('low-stock-products')
export class LowStockProductsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  analytics(@Query() query: GetAnalyticsListDto) {
    return this.analyticsService.findAllLowStockProducts(query);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('top-rate-product')
export class TopRateProductController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  analytics(@Query() query: GetAnalyticsListDto) {
    return this.analyticsService.findAllTopRateProduct(query);
  }
}
