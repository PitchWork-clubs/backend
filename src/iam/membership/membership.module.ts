import { Module } from '@nestjs/common';
import { AuthModule } from '@iam/auth/auth.module';
import { AuditLogsModule } from '@infrastructure/audit-logs/audit-logs.module';
import { MembershipService } from './membership.service';
import { MembershipResolver } from './membership.resolver';
import { MembershipController } from './membership.controller';

@Module({
  imports: [AuthModule, AuditLogsModule],
  controllers: [MembershipController],
  providers: [MembershipService, MembershipResolver],
  exports: [MembershipService],
})
export class MembershipModule {}
