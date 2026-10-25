import { PickType } from '@nestjs/swagger';
import { Withdraw } from '../entities/withdraw.entity.js';

export class ApproveWithdrawDto extends PickType(Withdraw, ['id', 'status']) {}
