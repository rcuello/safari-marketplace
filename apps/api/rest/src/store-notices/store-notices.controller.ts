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
import { GetUsersDto } from '#src/users/dto/get-users.dto.js';
import { UsersService } from '#src/users/users.service.js';
import { CreateStoreNoticeDto } from './dto/create-store-notice.dto.js';
import { GetStoreNoticesDto } from './dto/get-store-notices.dto.js';
import { UpdateStoreNoticeDto } from './dto/update-store-notice.dto.js';
import { StoreNoticesService } from './store-notices.service.js';
import {
  ADMIN_AND_OWNER,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';

// `is_read` es por usuario (US-51): toda ruta que proyecta un aviso necesita
// saber quién consulta, por eso @CurrentUser va en lecturas y escrituras.
@Permissions(...ADMIN_AND_OWNER)
@Controller('store-notices')
export class StoreNoticesController {
  constructor(
    private readonly storeNoticesService: StoreNoticesService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  createStoreNotice(
    @Body() createStoreNoticeDto: CreateStoreNoticeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.storeNoticesService.create(createStoreNoticeDto, user.sub);
  }

  // Ruta literal antes de las parametrizadas, como `getUsersToNotify`. El
  // admin la llama desde la barra superior (`useStoreNoticeRead`) con `{id}`.
  @Post('read')
  markAsRead(@Body('id') id: unknown, @CurrentUser() user: CurrentUserPayload) {
    return this.storeNoticesService.markAsRead(id, user.sub);
  }

  @Get()
  getStoreNotices(
    @Query() query: GetStoreNoticesDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.storeNoticesService.getStoreNotices(query, user.sub);
  }

  @Get('getUsersToNotify')
  getAllUsers(@Query() query: GetUsersDto) {
    return this.usersService.getUsersNotify(query);
  }

  @Get(':param')
  getStoreNotice(
    @Param('param') param: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.storeNoticesService.getStoreNotice(param, user.sub);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateStoreNoticeDto: UpdateStoreNoticeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.storeNoticesService.update(+id, updateStoreNoticeDto, user.sub);
  }

  @Delete(':id')
  deleteStoreNotice(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.storeNoticesService.remove(+id, user.sub);
  }
}
