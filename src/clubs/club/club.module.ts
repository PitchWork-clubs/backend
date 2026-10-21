import { Module } from '@nestjs/common';
import { AuditLogsModule } from '@infrastructure/audit-logs/audit-logs.module';
import { ClubService } from './club.service';
import { ClubResolver } from './club.resolver';
import { AuthModule } from '@iam/auth/auth.module';
import { CloudinaryUploadInterceptor } from '../../media/cloudinary/cloudinary.interceptor';
import { CloudinaryService } from '../../media/cloudinary/cloudinary.service';
import { CloudinaryProvider } from '../../media/cloudinary/cloudinary.provider';
import { ClubController } from './club.controller';

@Module({
  imports: [AuditLogsModule, AuthModule],
  providers: [
    ClubService,
    ClubResolver,
    CloudinaryUploadInterceptor,
    CloudinaryService,
    CloudinaryProvider,
  ],
  controllers: [ClubController],
  exports: [ClubService],
})
export class ClubModule {}
