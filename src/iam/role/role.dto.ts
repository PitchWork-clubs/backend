import { Field, InputType } from '@nestjs/graphql';
import { ENScopeType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class UpdateRoleInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 10)
  name!: string;

  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 100)
  description!: string;
}

export { UpdateRoleInput as UpdateRoleDto };

@InputType()
export class AssignRoleInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 10)
  roleCode!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEnum(ENScopeType)
  scope?: ENScopeType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scopeId?: string;
}

export { AssignRoleInput as AssignRoleDto };

@InputType()
export class CreateRoleInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 10)
  roleCode!: string;

  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 10)
  name!: string;

  @Field(() => String)
  @IsNotEmpty()
  @IsString()
  @Length(3, 100)
  description!: string;
}

export { CreateRoleInput as CreateRoleDto };
