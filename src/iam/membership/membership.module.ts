import { Module } from '@nestjs/common';
import { AuthModule } from '@iam/auth/auth.module';
import { MembershipService } from './membership.service';
import { MembershipResolver } from './membership.resolver';
import { MembershipController } from './membership.controller';

@Module({
  imports: [AuthModule],
  controllers: [MembershipController],
  providers: [MembershipService, MembershipResolver],
  exports: [MembershipService],
})
export class MembershipModule {}
