import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { PermissionResolver } from './permission.resolver';
import { AuditLogsModule } from '@infrastructure/audit-logs/audit-logs.module';
import { AuthModule } from '@iam/auth/auth.module';
import { PermissionController } from './permission.controller';

@Module({
  imports: [AuditLogsModule, AuthModule],
  controllers: [PermissionController],
  providers: [PermissionService, PermissionResolver],
  exports: [PermissionService],
})
export class PermissionModule {}
