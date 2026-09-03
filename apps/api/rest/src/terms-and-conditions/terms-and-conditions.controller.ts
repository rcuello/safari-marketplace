import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TermsAndConditionsService } from './terms-and-conditions.service';
import { GetTermsAndConditionsDto } from './dto/get-terms-and-conditions.dto';
import { CreateTermsAndConditionsDto } from './dto/create-terms-and-conditions.dto';
import { UpdateTermsAndConditionsDto } from './dto/update-terms-and-conditions.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('terms-and-conditions')
export class TermsAndConditionsController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  createTermsAndConditions(
    @Body() createTermsAndConditionsDto: CreateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.create(createTermsAndConditionsDto);
  }

  @Public()
  @Get()
  getTermsAndConditions(@Query() query: GetTermsAndConditionsDto) {
    return this.termsAndConditionsService.findAllTermsAndConditions(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.termsAndConditionsService.findOne(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  updateTermsConditions(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateTermsAndConditionsDto: UpdateTermsAndConditionsDto,
  ) {
    return this.termsAndConditionsService.update(
      +id,
      updateTermsAndConditionsDto,
    );
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  deleteTermsAndConditions(@Param('id') id: string) {
    return this.termsAndConditionsService.remove(+id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('disapprove-terms-and-conditions')
export class DisapproveTermsAndConditionController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @Post()
  async disapproveTermsAndCondition(@Body('id') id) {
    return this.termsAndConditionsService.disapproveTermsAndCondition(id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('approve-terms-and-conditions')
export class ApproveTermsAndConditionController {
  constructor(private termsAndConditionsService: TermsAndConditionsService) {}

  @Post()
  async approveTermsAndCondition(@Body('id') id) {
    return this.termsAndConditionsService.approveTermsAndCondition(id);
  }
}
