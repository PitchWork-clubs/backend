/*
  Warnings:

  - A unique constraint covering the columns `[token_hash]` on the table `invitations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
