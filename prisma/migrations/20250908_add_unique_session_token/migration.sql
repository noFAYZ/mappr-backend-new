-- AddUniqueConstraintToSessionToken
ALTER TABLE "session" ADD CONSTRAINT "session_token_key" UNIQUE ("token");