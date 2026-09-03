import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import { BecomeSellerService } from './become-seller.service';
import { Public } from 'src/auth/decorators/public.decorator';

// Solicitud de quien AÚN NO es vendedor; become-seller.ts ya prefetchea el
// GET sin token (cierre del usuario, proposal.md).
@Public()
@Controller('became-seller')
export class BecomeSellerController {
  constructor(private readonly becomeSellerService: BecomeSellerService) {}

  @Post()
  create(@Body() createBecomeSellerDto: CreateBecomeSellerDto) {
    return this.becomeSellerService.create(createBecomeSellerDto);
  }

  @Get()
  findAll() {
    return this.becomeSellerService.findAll();
  }
}
