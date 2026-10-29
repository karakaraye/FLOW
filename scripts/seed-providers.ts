import "dotenv/config";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { providerMetadata } from "../src/lib/integrations/providers";
async function main() {
  for (const provider of providerMetadata) {
    const data = {
      ...provider,
      requiredScopes: [...provider.requiredScopes],
      capabilities: [...provider.capabilities],
      configurationSchema:
        provider.configurationSchema as Prisma.InputJsonValue,
    };
    await db.integrationProvider.upsert({
      where: { id: provider.id },
      create: data,
      update: {
        ...data,
        // Preserve an operator-disabled provider when refreshing catalog metadata.
        state: undefined,
      },
    });
  }
  console.log(
    "Provider metadata seeded. No external provider was authenticated or enabled.",
  );
}
main()
  .catch(() => {
    console.error("Provider metadata seeding failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
