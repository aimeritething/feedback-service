import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export async function runMigrations(connectionString: string, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) await client.query(await readFile(join(dir, file), "utf8"));
  } finally {
    await client.end();
  }
  return files;
}
