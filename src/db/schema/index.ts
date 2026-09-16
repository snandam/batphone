/**
 * Database Schema
 *
 * Export all table schemas from here.
 * This file is imported by the Drizzle instance to enable typed queries.
 */

// Auth tables (required by Better Auth)
export * from "./auth";

// App tables
export * from "./users";
export * from "./contacts";
export * from "./calls";
export * from "./twilio-events";
export * from "./resolution-attempts";
