import { join } from "node:path";
import { runMigrations } from "../src/migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const applied = await runMigrations(url, join(import.meta.dirname, "..", "migrations"));
console.log(`applied: ${applied.join(", ")}`);
