import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url);
const workflows = Object.fromEntries(
  readdirSync(workflowsDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, readFileSync(new URL(name, workflowsDirectory), "utf8")])
);
const serverless = readFileSync(new URL("../serverless.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const ciDatabaseConfig = readFileSync(
  new URL("../config/database-url.ci.yml", import.meta.url),
  "utf8"
);
const prodDatabaseConfig = readFileSync(
  new URL("../config/database-url.prod.yml", import.meta.url),
  "utf8"
);
const expectedWorkflowHashes = {
  "agent-harness-check.yml": "037ec6c1596865787048792d6937c41ddf092ebcb953a54150f3e7a97259481e",
  "ci.yml": "a148a72ac11b963b72bd1e5eeb957690d8cfd0a8ba2423b36412b9ae4cede8f5",
  "deploy-prod.yml": "4a460c0836d7cc3238f74fdb30992e291cc2fe25f53128be4a44c2f4e8c94042"
};
const expectedScripts = {
  dev: "tsx watch src/local.ts",
  build: "tsc -p tsconfig.json",
  start: "node dist/server.js",
  migrate: "tsx src/migrate.ts",
  "migrate:dist": "node dist/migrate.js",
  test: "vitest run",
  "test:deploy-gate": "node scripts/check-production-deploy-gate.mjs",
  lint: "tsc -p tsconfig.json --noEmit",
  package: "serverless package --stage ci"
};

const expectedWorkflow = `name: Deploy Admin API prod

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  production-deployment-disabled:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - name: Production deployment is disabled
        run: |
          echo "Admin production deploy is blocked until an additive release path is certified." >&2
          exit 1
`;

const findings = validate(workflows, serverless, packageJson, ciDatabaseConfig, prodDatabaseConfig);
if (findings.length > 0) fail(findings.join("; "));

const alternateSinkWorkflow = `name: Shadow production deploy
on:
  push:
    branches: [main]
permissions:
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm exec serverless deploy --stage prod
`;
const indirectSinkWorkflow = `name: Indirect production deploy
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/aws-cloudformation-github-deploy@v1
      - run: aws lambda update-function-code --function-name prod
      - run: ./scripts/release-production.sh
`;

for (const [name, unsafeWorkflows, unsafeServerless, unsafePackage, unsafeCiDatabase, unsafeProdDatabase] of [
  ["push trigger", { ...workflows, "deploy-prod.yml": expectedWorkflow.replace("  workflow_dispatch:\n", "  push:\n    branches: [main]\n") }, serverless, packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["AWS deploy sink", { ...workflows, "deploy-prod.yml": expectedWorkflow.replace("          exit 1\n", "          pnpm exec serverless deploy --stage prod\n") }, serverless, packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["alternate workflow sink", { ...workflows, "shadow-prod.yml": alternateSinkWorkflow }, serverless, packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["indirect workflow sink", { ...workflows, "indirect-prod.yml": indirectSinkWorkflow }, serverless, packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["default prod stage with comment decoy", workflows, serverless.replace("  stage: ${opt:stage}", "  stage: prod\n  # stage: ${opt:stage}"), packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["database provider comment decoy", workflows, serverless.replace("    DATABASE_URL: ${file(./config/database-url.${self:provider.stage}.yml):value}", "    DATABASE_URL: ${env:DATABASE_URL}\n    # DATABASE_URL: ${file(./config/database-url.${self:provider.stage}.yml):value}"), packageJson, ciDatabaseConfig, prodDatabaseConfig],
  ["prod database env override", workflows, serverless, packageJson, ciDatabaseConfig, "value: ${env:DATABASE_URL}\n"],
  ["alternate release script", workflows, serverless, { ...packageJson, scripts: { ...packageJson.scripts, "release:prod": "serverless deploy --stage prod" } }, ciDatabaseConfig, prodDatabaseConfig],
  ["indirect release script", workflows, serverless, { ...packageJson, scripts: { ...packageJson.scripts, release: "node scripts/release-production.mjs" } }, ciDatabaseConfig, prodDatabaseConfig]
]) {
  if (validate(unsafeWorkflows, unsafeServerless, unsafePackage, unsafeCiDatabase, unsafeProdDatabase).length === 0) {
    fail(`negative fixture '${name}' was accepted`);
  }
}

console.log("All workflows are sink-free; production deploy is disabled; stage and database source are fail-closed.");

function validate(workflowValues, serverlessValue, packageValue, ciDatabaseValue, prodDatabaseValue) {
  const errors = [];
  const workflowNames = Object.keys(workflowValues).sort();
  const expectedWorkflowNames = Object.keys(expectedWorkflowHashes).sort();
  if (JSON.stringify(workflowNames) !== JSON.stringify(expectedWorkflowNames)) {
    errors.push("workflow file set must match the reviewed allowlist");
  }
  for (const [name, expectedHash] of Object.entries(expectedWorkflowHashes)) {
    const value = workflowValues[name];
    const actualHash = value ? createHash("sha256").update(value).digest("hex") : "missing";
    if (actualHash !== expectedHash) {
      errors.push(`workflow '${name}' differs from the reviewed allowlist`);
    }
  }
  if (workflowValues["deploy-prod.yml"] !== expectedWorkflow) {
    errors.push("production workflow must remain the exact fail-closed stub");
  }

  const forbiddenWorkflowSink = /id-token:\s*write|aws-actions\/configure-aws-credentials|\b(?:pnpm exec )?(?:serverless|sls)\s+deploy\b|\baws\s+lambda\s+invoke\b|\baws\s+(?:cloudformation|amplify|ecs|rds)\b/i;
  for (const [name, value] of Object.entries(workflowValues)) {
    if (name !== "deploy-prod.yml" && forbiddenWorkflowSink.test(value)) {
      errors.push(`alternate workflow '${name}' contains a production-capable sink`);
    }
  }

  const uncommentedServerless = serverlessValue.replace(/^\s*#.*$/gm, "");
  const stageDeclarations = [...uncommentedServerless.matchAll(/^\s*stage:\s*(.+?)\s*$/gm)]
    .map((match) => match[1]);
  if (stageDeclarations.length !== 1 || stageDeclarations[0] !== "${opt:stage}") {
    errors.push("Serverless must contain exactly one mandatory stage declaration");
  }
  const databaseDeclarations = [...uncommentedServerless.matchAll(/^\s*DATABASE_URL:\s*(.+?)\s*$/gm)]
    .map((match) => match[1]);
  if (databaseDeclarations.length !== 1 || databaseDeclarations[0] !== "${file(./config/database-url.${self:provider.stage}.yml):value}") {
    errors.push("provider database must resolve through the stage allowlist");
  }
  if (ciDatabaseValue !== "value: ${env:DATABASE_URL}\n") {
    errors.push("ci database config must use explicit DATABASE_URL");
  }
  if (prodDatabaseValue !== "value: ${ssm:/autonomia/prod/admin/database-url}\n") {
    errors.push("prod database config must use exclusively its SSM path");
  }

  const scriptNames = Object.keys(packageValue.scripts ?? {}).sort();
  const expectedScriptNames = Object.keys(expectedScripts).sort();
  if (JSON.stringify(scriptNames) !== JSON.stringify(expectedScriptNames)) {
    errors.push("package scripts must match the reviewed allowlist");
  }
  for (const [name, expectedValue] of Object.entries(expectedScripts)) {
    if (packageValue.scripts?.[name] !== expectedValue) {
      errors.push(`package script '${name}' differs from the reviewed allowlist`);
    }
  }
  const forbiddenScriptSink = /\b(?:serverless|sls)\s+deploy\b|\baws\s+lambda\s+invoke\b/i;
  for (const [name, value] of Object.entries(packageValue.scripts ?? {})) {
    if (forbiddenScriptSink.test(value)) {
      errors.push(`package script '${name}' contains a production-capable sink`);
    }
  }
  return errors;
}

function fail(message) {
  console.error(`Deploy gate check failed: ${message}`);
  process.exit(1);
}
