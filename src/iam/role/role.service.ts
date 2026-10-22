import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TActiveMembershipPayload } from '@common/guards/active-membership.guard';
import { parsePrismaError } from '@common/utils/error-handler';
import { ENScopeType, Prisma } from '@prisma/client';
import { ResourceNotFoundException } from '@common/exceptions/resource-not-found';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';
import { AuditLogsService } from '@infrastructure/audit-logs/audit-logs.service';
import { ENFeature } from '@prisma/client';

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  public async getRolesInClub(clubId: string) {
    return await this.prisma.role.findMany({
      where: {
        OR: [{ isSystem: true }, { clubId, isSystem: false }],
      },
    });
  }

  public async getRole(role_id: string, clubId: string, membershipId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: role_id },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    if (!role) throw new ResourceNotFoundException('Role not found', 'role');

    if (!role.isSystem && role.clubId !== clubId)
      throw new BadRequestException('Role does not belong to the club');

    const membershipRoles = await this.prisma.membershipRole.findMany({
      where: {
        membershipId,
        roleId: role_id,
      },
    });

    return { ...role, membershipRoles };
  }

  public async updatedClubRole(
    role_id: string,
    data: UpdateRoleDto,
    clubId: string,
    user_id: string,
  ) {
    const { name, description } = data;
    const role = await this.prisma.role.findUnique({ where: { id: role_id } });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');

    if (role.isSystem) throw new BadRequestException('System roles cannot be modified');
    if (role.clubId !== clubId)
      throw new BadRequestException('Role does not belong to the club');

    const updatedRole = await this.prisma.role.update({
      where: { id: role_id },
      data: { name, description },
    });

    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-updated',
      entityType: 'Role',
      entityId: role_id,
      doneById: user_id,
      metadata: { club_id: clubId },
    });

    return updatedRole;
  }

  public async assignRole(
    adminMembership: TActiveMembershipPayload,
    targetMembershipId: string,
    roleCode: string,
    user_id: string,
    scope: any = 'OWN',
    scopeId?: string,
  ) {
    const targetMembership = await this.prisma.membership.findUnique({
      where: { id: targetMembershipId },
    });
    if (!targetMembership)
      throw new ResourceNotFoundException(
        'Target membership not found',
        'membership',
      );

    if (targetMembership.clubId !== adminMembership.clubId)
      throw new BadRequestException('Target membership does not belong to the same club');

    if (scope === ENScopeType.TEAM) {
      if (!scopeId) {
        throw new BadRequestException('A team is required for a TEAM-scoped role');
      }
      const team = await this.prisma.team.findFirst({
        where: { id: scopeId, clubId: adminMembership.clubId },
      });
      if (!team) {
        throw new BadRequestException('Team does not belong to the same club');
      }
    } else if (scopeId) {
      throw new BadRequestException('scopeId is only valid for a TEAM-scoped role');
    }

    const role = await this.prisma.role.findFirst({
      where: {
        code: roleCode,
        isActive: true,
        OR: [{ clubId: adminMembership.clubId }, { isSystem: true }],
      },
    });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');

    const assignment = await this.prisma.membershipRole.upsert({
      where: {
        membershipId_roleId_scope_scopeId: {
          membershipId: targetMembershipId,
          roleId: role.id,
          scope,
          scopeId: scopeId ?? '',
        },
      },
      create: {
        membershipId: targetMembershipId,
        roleId: role.id,
        scope,
        scopeId: scopeId ?? null,
        assignedById: adminMembership.id,
      },
      update: {},
    });
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-assigned',
      entityType: 'MembershipRole',
      entityId: assignment.id,
      doneById: user_id,
      metadata: { membership_id: targetMembershipId, role_code: roleCode, scope, scope_id: scopeId },
    });
    return assignment;
  }

  public async revokeRole(
    adminMembership: TActiveMembershipPayload,
    targetMembershipId: string,
    roleCode: string,
    user_id: string,
    scope?: any,
    scopeId?: string,
  ) {
    // user_id is for the admin
    const targetMembership = await this.prisma.membership.findUnique({
      where: { id: targetMembershipId },
    });
    if (!targetMembership)
      throw new ResourceNotFoundException(
        'Target membership not found',
        'membership',
      );

    if (targetMembership.clubId !== adminMembership.clubId)
      throw new BadRequestException('Target membership does not belong to the same club');

    const role = await this.prisma.role.findFirst({
      where: {
        code: roleCode,
        OR: [{ clubId: adminMembership.clubId }, { isSystem: true }],
      },
    });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');

    if (!role.isSystem && role.clubId !== adminMembership.clubId)
      throw new BadRequestException('Role does not belong to the club');

    try {
      const result = await this.prisma.membershipRole.deleteMany({
        where: {
          membershipId: targetMembershipId,
          roleId: role.id,
          ...(scope ? { scope } : {}),
          ...(scopeId !== undefined ? { scopeId } : {}),
        },
      });
      await this.auditLogs.createLog({
        category: ENFeature.ACCESS,
        action: 'role-revoked',
        entityType: 'MembershipRole',
        entityId: targetMembershipId,
        doneById: user_id,
        metadata: { membership_id: targetMembershipId, role_code: roleCode, scope, scope_id: scopeId, count: result.count },
      });
      return true;
    } catch (error) {
      throw new InternalServerErrorException(parsePrismaError(error));
    }
  }

  public async createRole(
    data: CreateRoleDto,
    clubId: string,
    user_id: string,
  ) {
    const { roleCode, name, description } = data;
    const existingRole = await this.prisma.role.findFirst({
      where: {
        code: roleCode,
        OR: [{ clubId }, { isSystem: true }],
      },
    });
    if (existingRole)
      throw new BadRequestException('Role with same code already exists');

    const role = await this.prisma.role.create({
      data: {
        code: roleCode,
        name,
        clubId,
        description,
        isSystem: false,
      },
    });

    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-created',
      entityType: 'Role',
      entityId: role.id,
      doneById: user_id,
      metadata: { club_id: clubId, role_code: role.code },
    });

    return role;
  }

  public async deleteRole(roleId: string, clubId: string, user_id: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');

    if (role.isSystem)
      throw new BadRequestException('System roles cannot be deleted');

    if (role.clubId !== clubId)
      throw new BadRequestException('Role does not belong to the club');

    await this.prisma.role.delete({ where: { id: roleId } });

    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-deleted',
      entityType: 'Role',
      entityId: roleId,
      doneById: user_id,
      metadata: { club_id: clubId },
    });

    return role;
  }

  public async retireRole(roleId: string, clubId: string, userId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');
    if (role.isSystem) throw new BadRequestException('System roles cannot be retired');
    if (role.clubId !== clubId) throw new BadRequestException('Role does not belong to the club');
    if (!role.isActive) return role;

    const retired = await this.prisma.role.update({
      where: { id: roleId },
      data: { isActive: false },
    });
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-retired',
      entityType: 'Role',
      entityId: roleId,
      doneById: userId,
      metadata: { club_id: clubId },
    });
    return retired;
  }

  public async assignPermission(roleId: string, permissionCode: string, clubId: string, userId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');
    if (role.isSystem) throw new BadRequestException('System roles cannot be modified');
    if (role.clubId !== clubId) throw new BadRequestException('Role does not belong to the club');
    const permission = await this.prisma.permission.findUnique({ where: { code: permissionCode } });
    if (!permission) throw new ResourceNotFoundException('Permission not found', 'permission');
    const assignment = await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      create: { roleId, permissionId: permission.id },
      update: {},
    });
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-permission-assigned',
      entityType: 'RolePermission',
      entityId: assignment.id,
      doneById: userId,
      metadata: { role_id: roleId, permission_code: permissionCode },
    });
    return assignment;
  }

  public async removePermission(roleId: string, permissionCode: string, clubId: string, userId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ResourceNotFoundException('Role not found', 'role');
    if (role.isSystem) throw new BadRequestException('System roles cannot be modified');
    if (role.clubId !== clubId) throw new BadRequestException('Role does not belong to the club');
    const permission = await this.prisma.permission.findUnique({ where: { code: permissionCode } });
    if (!permission) throw new ResourceNotFoundException('Permission not found', 'permission');
    const result = await this.prisma.rolePermission.deleteMany({ where: { roleId, permissionId: permission.id } });
    await this.auditLogs.createLog({
      category: ENFeature.ACCESS,
      action: 'role-permission-removed',
      entityType: 'RolePermission',
      entityId: roleId,
      doneById: userId,
      metadata: { role_id: roleId, permission_code: permissionCode, count: result.count },
    });
    return result;
  }
}
