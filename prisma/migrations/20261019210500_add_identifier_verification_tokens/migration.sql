-- Add phone verification support to the token model.
ALTER TYPE "ENUserTokenType" ADD VALUE IF NOT EXISTS 'PHONE_VERIFICATION';

ALTER TABLE "user_tokens"
ADD COLUMN "identifier_id" TEXT;

CREATE INDEX "user_tokens_identifier_id_idx"
ON "user_tokens"("identifier_id");

ALTER TABLE "user_tokens"
ADD CONSTRAINT "user_tokens_identifier_id_fkey"
FOREIGN KEY ("identifier_id") REFERENCES "user_identifiers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
