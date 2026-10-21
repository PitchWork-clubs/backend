import { Module } from '@nestjs/common';
import { RoleService } from './role.service';
import { RoleResolver } from './role.resolver';
import { AuditLogsModule } from '@infrastructure/audit-logs/audit-logs.module';
import { AuthModule } from '@iam/auth/auth.module';
import { RoleController } from './role.controller';

@Module({
  imports: [AuditLogsModule, AuthModule],
  controllers: [RoleController],
  providers: [RoleService, RoleResolver],
  exports: [RoleService],
})
export class RoleModule {}
