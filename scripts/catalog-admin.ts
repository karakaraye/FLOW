import "dotenv/config";
import { db } from "../src/lib/db";
async function main() {
  const [action, userId] = process.argv.slice(2);
  if (!["grant", "revoke"].includes(action) || !userId)
    throw new Error(
      "Usage: npm run catalog:admin -- grant|revoke <existing-user-id>",
    );
  if (action === "grant") {
    await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.platformAdministrator.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  } else await db.platformAdministrator.deleteMany({ where: { userId } });
  console.log(
    `Catalog permission ${action === "grant" ? "granted" : "revoked"}.`,
  );
}
main()
  .catch(() => {
    console.error(
      "Permission update failed. Supply an existing user ID and grant|revoke.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
