import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const password = randomBytes(24).toString("hex");
const contents = `POSTGRES_USER=flowpilot\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=flowpilot\nDATABASE_URL=postgresql://flowpilot:${password}@localhost:5432/flowpilot?schema=public\nBETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nBETTER_AUTH_URL=http://localhost:3000\n`;
try {
  writeFileSync(new URL("../.env", import.meta.url), contents, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Created ignored .env with random local development credentials.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Existing .env preserved.");
}
