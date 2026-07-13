import { readFile } from "node:fs/promises";

const reportPath = new URL("../.vitest-results.json", import.meta.url);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const total = Number(report.numTotalTests ?? 0);
const skipped = Number(report.numPendingTests ?? 0);

if (!total) {
  console.error("Test gate failed: no tests were executed.");
  process.exit(1);
}

if (skipped) {
  console.error(`Test gate failed: ${skipped} test(s) were skipped.`);
  process.exit(1);
}

console.info(`Test gate passed: ${total} test(s), zero skipped.`);
