import { Global, Module } from '@nestjs/common';
import { AccessResolutionService } from './access-resolution.service';
import { ActiveMembershipGuard } from './active-membership.guard';
import { FeatureGuard } from './feature.guard';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [AccessResolutionService, ActiveMembershipGuard, FeatureGuard, PermissionsGuard],
  exports: [AccessResolutionService, ActiveMembershipGuard, FeatureGuard, PermissionsGuard],
})
export class AccessModule {}
