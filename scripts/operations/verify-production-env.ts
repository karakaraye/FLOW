import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { runtimeIssues } from "../../src/lib/security/runtime";

const envFile = process.argv[2] || ".env.production.example";

if (!existsSync(envFile)) {
  console.error(`❌ Error: Environment file ${envFile} does not exist.`);
  process.exit(1);
}

const raw = readFileSync(envFile, "utf8");
const parsed = parse(raw);

// Check issues
const issues = runtimeIssues(parsed);

console.log("==================================================================");
console.log(`🔍 Production Pre-Flight Audit: ${envFile}`);
console.log("==================================================================");

if (issues.length === 0) {
  console.log("✅ All production security and environment checks PASSED!");
  console.log("🚀 This configuration is safe and ready for live deployment.");
} else {
  console.log(`⚠️ Note: Found ${issues.length} item(s) to populate with real keys before booting production:`);
  for (const issue of issues) {
    console.log(`   - ${issue}`);
  }
}
console.log("==================================================================");

