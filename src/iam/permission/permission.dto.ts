import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { ENScopeType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

@InputType()
export class GrantPermissionInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  permissionCode!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEnum(ENScopeType)
  scope?: ENScopeType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scopeId?: string;
}

export { GrantPermissionInput as GrantPermissionDto };

@InputType()
export class RevokePermissionInput extends GrantPermissionInput {}

export { RevokePermissionInput as RevokePermissionDto };

@ObjectType()
export class SyncPermissionsOutput {
  @Field(() => Int)
  syncedCount!: number;

  @Field(() => String)
  message!: string;
}
