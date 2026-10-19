import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { generateAuditDescription } from './audit.utils';
import { ENAuditLogResult, ENFeature, Prisma } from '@prisma/client';

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createLog(
    params: {
      category: ENFeature;
      action: string;
      entityType: string;
      entityId?: string;
      result?: ENAuditLogResult;
      metadata?: Record<string, any>;
      doneById?: string;
      createdBy?: string;
      description?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const {
      category,
      action,
      entityType,
      entityId = 'system',
      result = ENAuditLogResult.SUCCESS,
      metadata,
      doneById,
      createdBy,
    } = params;

    const description =
      params.description ?? generateAuditDescription(action, metadata ?? {});
    const db = tx ?? this.prisma;

    try {
      return await db.auditLog.create({
        data: {
          category,
          action,
          result,
          entityType,
          entityId,
          description,
          metadata: metadata ?? Prisma.JsonNull,
          doneById: doneById ?? createdBy ?? 'system',
        },
      });
    } catch (error) {
      // Audit failures should never break the parent operation
      this.logger.error(`Failed to record audit log for action: ${action}`, error);
      return null;
    }
  }
}
