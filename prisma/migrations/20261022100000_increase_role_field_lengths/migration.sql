-- Allow club roles to use descriptive names and codes without changing their semantics.
ALTER TABLE "roles"
  ALTER COLUMN "code" TYPE VARCHAR(50),
  ALTER COLUMN "name" TYPE VARCHAR(100),
  ALTER COLUMN "description" TYPE VARCHAR(500);
