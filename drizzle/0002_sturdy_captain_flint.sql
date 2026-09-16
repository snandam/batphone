ALTER TABLE "call" ADD COLUMN "answered_by" text;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "machine_detection_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "call" ADD COLUMN "caller_spoke" boolean;