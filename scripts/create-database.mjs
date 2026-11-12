/**
 * Create the application database if it does not exist.
 *
 * Used by scripts/setup-db.ps1. It connects to the maintenance database and
 * issues CREATE DATABASE, because the portable PostgreSQL build that ships as
 * an npm package contains the server binaries but not psql/createdb.
 *
 * Environment:
 *   NAVIKA_ADMIN_DATABASE_URL  connection string for the "postgres" database
 *   NAVIKA_DATABASE_NAME       database to create (default busguard)
 */
import { Client } from "pg";

const url = process.env.NAVIKA_ADMIN_DATABASE_URL;
const database = process.env.NAVIKA_DATABASE_NAME || "busguard";

if (!url) {
  console.error("NAVIKA_ADMIN_DATABASE_URL is not set.");
  process.exit(1);
}

const client = new Client({ connectionString: url });

try {
  await client.connect();
  const { rowCount } = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [database],
  );

  if (rowCount) {
    console.log(`  database '${database}' already existed`);
  } else {
    // CREATE DATABASE does not accept parameters. The name is a fixed internal
    // value here, not user input, and the quotes are escaped anyway.
    const quoted = `"${database.replace(/"/g, '""')}"`;
    await client.query(`CREATE DATABASE ${quoted}`);
    console.log(`  database '${database}' created`);
  }
} finally {
  await client.end();
}
