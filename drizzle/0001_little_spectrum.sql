CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"phone" text NOT NULL,
	"speed_dial" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" text,
	"contact_name_snapshot" text,
	"destination_number_snapshot" text,
	"from_number" text NOT NULL,
	"twilio_call_sid" text NOT NULL,
	"dial_call_sid" text,
	"recording_sid" text,
	"recording_status" text,
	"status" text NOT NULL,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"transcribe_attempts" integer DEFAULT 0 NOT NULL,
	"inbound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"recording_started_at" timestamp with time zone,
	"recording_duration_sec" integer,
	"dial_duration_sec" integer,
	"transcript" jsonb,
	"transcript_text" text,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_claimed_at" timestamp with time zone,
	"last_email_error" text,
	"metadata_email_sent_at" timestamp with time zone,
	"transcript_email_sent_at" timestamp with time zone,
	"email_message_id" text,
	"emailed_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_twilio_call_sid_unique" UNIQUE("twilio_call_sid"),
	CONSTRAINT "call_dial_call_sid_unique" UNIQUE("dial_call_sid"),
	CONSTRAINT "call_recording_sid_unique" UNIQUE("recording_sid")
);
--> statement-breakpoint
CREATE TABLE "twilio_event" (
	"id" text PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"recording_sid" text,
	"event_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"input_kind" text NOT NULL,
	"heard_text" text NOT NULL,
	"confidence" real,
	"normalized_query" text NOT NULL,
	"candidates" jsonb NOT NULL,
	"decision" text NOT NULL,
	"chosen_contact_id" text,
	"caller_response" text,
	"selected_position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "next_speed_dial" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call" ADD CONSTRAINT "call_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_attempt" ADD CONSTRAINT "resolution_attempt_call_id_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_user_id_idx" ON "contact" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_user_id_name_normalized_idx" ON "contact" USING btree ("user_id","name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_user_id_speed_dial_idx" ON "contact" USING btree ("user_id","speed_dial");--> statement-breakpoint
CREATE INDEX "call_user_id_inbound_at_idx" ON "call" USING btree ("user_id","inbound_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "twilio_event_call_sid_idx" ON "twilio_event" USING btree ("call_sid");--> statement-breakpoint
CREATE INDEX "resolution_attempt_call_id_idx" ON "resolution_attempt" USING btree ("call_id");--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_phone_number_unique" UNIQUE("phone_number");