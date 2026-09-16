ALTER TABLE "user_profile" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "user_profile" SET "onboarding_completed_at" = now()
WHERE length(trim("first_name")) > 0
  AND length(trim("last_name")) > 0
  AND "phone_number" IS NOT NULL
  AND "phone_verified_at" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "contact" WHERE "contact"."user_id" = "user_profile"."user_id");
