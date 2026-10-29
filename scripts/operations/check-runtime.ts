import "dotenv/config";
import { runtimeIssues, production } from "../../src/lib/security/runtime";
const issues = runtimeIssues();
console.log(
  JSON.stringify({
    mode: production() ? "production" : "development",
    valid: issues.length === 0,
    issues,
  }),
);
if (issues.length) process.exitCode = 1;
