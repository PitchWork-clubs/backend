import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

@InputType()
export class GrantPermissionInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  permissionCode!: string;

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
