import "dotenv/config";
import { db } from "../src/lib/db";
import { seedCatalog } from "../src/lib/templates/catalog";
import { validateContent } from "../src/lib/templates/contracts";
import { Prisma } from "@prisma/client";
async function main() {
  for (const entry of seedCatalog) {
    const content = validateContent(entry.content);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flowpilot-template-catalog'))`;
      if (
        await tx.automationTemplate.findUnique({ where: { slug: entry.slug } })
      )
        return;
      if ((await tx.automationTemplate.count()) >= 200)
        throw new Error("Catalog capacity reached.");
      await tx.automationTemplate.create({
        data: {
          slug: entry.slug,
          draft: content as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          versions: {
            create: {
              number: 1,
              content: content as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
    });
  }
  console.log("Built-in catalog seeded; existing slugs preserved.");
}
main()
  .catch(() => {
    console.error("Catalog seeding failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
