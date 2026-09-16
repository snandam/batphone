/**
 * Database Connections
 *
 * Usage:
 *   import { db } from "@/db";
 *
 * Or import the connection module directly:
 *   import { db } from "@/db/primary";
 */

export {
  db as primaryDb,
  connection as primaryConnection,
  checkConnection as checkPrimaryConnection,
  closeConnection as closePrimaryConnection,
} from "./primary";

// Default export is the primary database for convenience
export { db } from "./primary";
