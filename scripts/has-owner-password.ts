import { Database } from "bun:sqlite";

const databasePath = Bun.argv[2];

if (!databasePath) {
  process.exit(2);
}

try {
  const database = new Database(databasePath, { readonly: true });
  try {
    const credential = database
      .query("SELECT 1 AS present FROM owner_credentials WHERE id = 1")
      .get();
    process.stdout.write(credential ? "yes" : "no");
  } finally {
    database.close();
  }
} catch {
  // A missing, pre-migration, or unreadable database simply has no usable
  // saved credential. bootstrap.ps1 will safely continue with first-run setup.
  process.exit(1);
}
