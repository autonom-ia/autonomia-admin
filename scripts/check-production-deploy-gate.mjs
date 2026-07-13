import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedWorkflowHashes = {
  "agent-harness-check.yml": "54da44abc1601840331ef13bc9d8be77e6f9b535c0814393407294fc811e1287",
  "ci.yml": "f33124072e327b65101cd2d47780e0bd7b2eb1a4abedc2f8ab026addf39f6c1e",
  "deploy-prod.yml": "4a460c0836d7cc3238f74fdb30992e291cc2fe25f53128be4a44c2f4e8c94042"
};
const expectedControlFileHashes = {
  ".claude/hooks/post-tool-use.sh": "c22a6a6eebdf115e82f78fce16d05e7b9e181cef1bdb938ac17b3cd9d34f04cc",
  ".claude/hooks/pre-tool-use.sh": "df869aeec593961db55059a777cef3eae69592718835d4ed802eeb8a8dffb5a0",
  "scripts/assert-no-skipped-tests.mjs": "b2c20a081c67f5cb3653d25de032659d0f6a2bb703609014861b5cc19072ca67",
  "scripts/check-production-deploy-gate.mjs": null,
  "scripts/harness-doctor.sh": "5551511532fb4d2cf09aafe2f5ba78310b6fa209afeee4b6c013f1424678d2c9",
  "scripts/run-local-migrations.ts": "4109ec52a16343e4abe26f29a1a25b9288f4632c48f15853fe0021912ffcb331",
  "scripts/start_rds_tunnel.sh": "177a567e8496ae9a7baef462be485be8352ee41c951e9a67f39335ad5aaf68ad",
  "scripts/validate-harness.sh": "659c30e05c1e757389bc563acfed7536f7bb04f5c37317b42f66836048aef89d"
};
const expectedFileHashes = {
  ".claude/settings.json": "337438ef4c53e63da75c374b38b3e28519080a31075ac584ee4bf51cb7793627",
  "package.json": "ce3acd18c6e7febc480902583f323806d11fb970396627e7054fecd25bbab401",
  "pnpm-lock.yaml": "b064cb2e4e2cfb2696bf7aedc954dada414ff581e77f0db326348e6da8ea973a",
  "serverless.yml": "feecb9385e1a8af53d4d194b17d0a700e82ee700976e1bfa3e22199771565bae"
};
const expectedRuntimeFileHashes = {
  "src/auth-sync.ts": "8f45481f3e0d19bde9ebacec8a5a1229aef436e1b3d935da886b4c9ef9b019d5",
  "src/auth.ts": "61f20582bf4814f06489f8be02e62213e033cbe40328a634b53058fe780e4704",
  "src/config.ts": "1712b059cd9493fae2c820e350d6bdcd1855f1eaf0a46fab30c063cc38abfd61",
  "src/db.ts": "b376cc04bad065962e4d6df1dfc293c95119efbaed45ae0239f19f579e9208ac",
  "src/fastify.d.ts": "8d2f2aad68c9bd9dcccefd720782cb8e821dda0624a64cfb41ad864b6d9bb128",
  "src/financial-sync.ts": "5444fbf4b0254fbb320eca3581a8f0bf06a74b6ec1d063deb00a39a8ec0bda2a",
  "src/lambda.ts": "2c0c747c3d55fa9d766c82ee30ef43ea78afb33dea2fb930db79113e7659b04e",
  "src/local-migration-guard.ts": "14d2e1ba0b51b70439acebea38459df36f7b6672111598651e425ace189ea262",
  "src/local.ts": "4dc6f946c92810e045e6a83832e773b6819634a98d27700300dae972400c6c96",
  "src/migrate-handler.ts": "c3e78610945e32fef627af047ce52358299a8a4c6a6c594585b428302e1cd7f5",
  "src/migrate.ts": "5223d5aae0dfaffe4fd3850cfa0f17d04329667bb4cfc9d36ecba4abf191fead",
  "src/repository.ts": "3d934d6c517fb241ed1e864ba850ba238f481f442de10c5c94fdace269a61b1e",
  "src/routes.ts": "806904220604622946a51a7c7423f11b31e5078ebee710cd3e3000cfe6342e1f",
  "src/server.ts": "178c05f01d65a330456a32ed3548ead9cf45e51870b331813cebaebf0ceac720",
  "src/types.ts": "416f18415822f906f6a8fa929e6cfe4ebe49ca471469f90d5d1eec580c655924",
  "src/uploads.ts": "9fc6fa53cb0d8f0c6c64c655bf0fee2782f9927071de5f10a154bd73c95c1689",
  "tests/admin-api.test.ts": "7c1fc043f47aeb6f329a7cc5d5cfe5104c775443af0c54f32b57d80069b49d44",
  "tests/fixtures/financial-catalog-schema.sql": "a900330fa7d0e1c151881c516a8e0d382cc29106081fafe89b5afbbb990db032",
  "tests/local-migration-guard.test.ts": "3085e25b7b7d8ebf23ef138765ada08229f4d36f252fecb67330d0a3c303e2cb",
  "tests/migrations.test.ts": "d5e24e3e38d39aaac2d456d1fcfb2133b19ad41e547f88f82466713192e8010b",
  "tests/rbac-migration.test.ts": "a96afb88f5e67fd10b185f5e13c380ab2b3bb071e5cfe274b49936759067bcc2",
  "tsconfig.json": "9c2480c7b62003485ef30accaf3ee888d36e08c29171043be9f71e85385174b5",
  "vitest.config.ts": "558cd52e00a6024ab97904bb7f3f60ad0569d9a035569d87531748ec93527c98"
};
const expectedMigrationFileHashes = {
  "database/migrations/001_create_admin_schema.sql": "03ee3f9bba34ba9db114bf1d035502b162c9e30bcb3203438cc6b1d032de391d",
  "database/migrations/002_add_profiles_and_customizations.sql": "6e2c17b57fbd3a3ee7e3dd457687b5774bd7e1d96d92da4c33c30978dfcd0dfc",
  "database/migrations/003_add_product_oauth_settings.sql": "50d8773ea8cb201abcc38c4b850e1a8c327e45b6450e7de4d3452439d7faa7f0",
  "database/migrations/004_add_product_service_display_order.sql": "8b232e36bec083ec4daacefffd6dc5f606151a9af3f5dbc09c1a65926caff3eb",
  "database/migrations/005_create_organizations.sql": "c88e62bd56e256d37c82e583b2b7027c35d01c1a1ba55e0f402804111352fb4b",
  "database/migrations/007_add_product_background_auth.sql": "1b93e3b9d3bdb9e8f898136cf3fd14000878addf2af216817df55c3f322d5f66",
  "database/migrations/008_rename_job_autonomia_product_key.sql": "ea18590dadb7717dc64966281d992ee0fb20e833d1d9c82e52606cf5226d1c37",
  "database/migrations/009_add_product_registration_urls.sql": "af15c67e96d16d1d91bd79347860d7ebda799da4b204a375540b5f64110a96e0",
  "database/migrations/010_configure_neuroai_registration_callback.sql": "a1d648d268f0ebedddcecc778e3dc47c1721d566f4355889a49796038def0429",
  "database/migrations/011_add_user_soft_delete.sql": "461332ca1f9bd2523279b7cc0d2b4422794165131076eb0815d3ea1abe2d05e2",
  "database/migrations/012_add_platform_superadmin_rbac.sql": "cc8f367117a256f20699e422ca5cfef2faa6bccaf4e007d21ecb5afcdde8403b"
};
const expectedScripts = {
  dev: "tsx watch src/local.ts",
  build: "tsc -p tsconfig.json",
  start: "node dist/server.js",
  "migrate:local": "tsx scripts/run-local-migrations.ts",
  test: "vitest run --reporter=default --reporter=json --outputFile.json=.vitest-results.json && node scripts/assert-no-skipped-tests.mjs",
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
const rootRunnerNames = new Set([
  "makefile",
  "gnumakefile",
  "justfile",
  "procfile",
  "taskfile.yml",
  "taskfile.yaml",
  "taskfile.dist.yml",
  "taskfile.dist.yaml"
]);
const expectedServerlessConfigs = ["serverless.yml"];
const expectedPackageManagerConfigs = ["package.json", "pnpm-lock.yaml"];
const expectedStageConfigs = ["database-url.ci.yml", "database-url.prod.yml"];
const expectedTestRunnerConfigs = ["vitest.config.ts"];

const findings = validate(loadState(repositoryRoot));
if (findings.length > 0) fail(findings.join("; "));

const physicalFixtures = [
  ["push trigger", (root) => replaceIn(root, ".github/workflows/deploy-prod.yml", "  workflow_dispatch:\n", "  push:\n    branches: [main]\n")],
  ["deployment sink", (root) => replaceIn(root, ".github/workflows/deploy-prod.yml", "          exit 1\n", "          pnpm exec serverless deploy --stage prod\n")],
  ["indirect workflow", (root) => write(root, ".github/workflows/indirect-prod.yml", "jobs:\n  deploy:\n    steps:\n      - run: ./scripts/release-production.sh\n")],
  ["default prod stage", (root) => replaceIn(root, "serverless.yml", "  stage: ${opt:stage}", "  stage: prod\n  # stage: ${opt:stage}")],
  ["database comment decoy", (root) => replaceIn(root, "serverless.yml", "    DATABASE_URL: ${file(./config/database-url.${self:provider.stage}.yml):value}", "    DATABASE_URL: ${env:DATABASE_URL}\n    # DATABASE_URL: ${file(./config/database-url.${self:provider.stage}.yml):value}")],
  ["prod database env override", (root) => replaceIn(root, "config/database-url.prod.yml", "${ssm:/autonomia/prod/admin/database-url}", "${env:DATABASE_URL}")],
  ["alternate release script", (root) => mutatePackage(root, (value) => { value.scripts["release:prod"] = "serverless deploy --stage prod"; })],
  ["indirect release script", (root) => mutatePackage(root, (value) => { value.scripts.release = "node scripts/release-production.mjs"; })],
  ["filesystem release runner", (root) => {
    write(root, "scripts/release-production.sh", "#!/usr/bin/env bash\nserverless deploy --stage prod\n");
    write(root, "Makefile", "release:\n\t./scripts/release-production.sh\n");
  }],
  ["post-tool hook sink", (root) => append(root, ".claude/hooks/post-tool-use.sh", "\nserverless deploy --stage prod\n")],
  ["doctor migration sink", (root) => append(root, "scripts/harness-doctor.sh", "\nnode dist/migrate.js\n")],
  ["tunnel release sink", (root) => append(root, "scripts/start_rds_tunnel.sh", "\nserverless deploy --stage prod\n")],
  ["serverless plugin hook", (root) => {
    replaceIn(root, "serverless.yml", "  - serverless-esbuild\n", "  - serverless-esbuild\n  - serverless-plugin-scripts\n");
    replaceIn(root, "serverless.yml", "custom:\n", "custom:\n  scripts:\n    hooks:\n      before:package:initialize: aws lambda update-function-code --function-name prod\n");
    mutatePackage(root, (value) => { value.devDependencies["serverless-plugin-scripts"] = "1.0.2"; });
  }],
  ["lockfile drift before install", (root) => append(root, "pnpm-lock.yaml", "\n")],
  ["local composite action", (root) => write(root, ".github/actions/release/action.yml", "runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: aws lambda update-function-code --function-name prod\n")],
  ["hook settings retarget", (root) => replaceIn(root, ".claude/settings.json", "bash .claude/hooks/post-tool-use.sh", "bash scripts/release-production.sh")],
  ["alternate Serverless config", (root) => write(root, "serverless.js", "module.exports = { service: 'prod-release' };\n")],
  ["package-manager script shell", (root) => {
    write(root, ".npmrc", "script-shell=./release\n");
    write(root, "release", "#!/usr/bin/env bash\nserverless deploy --stage prod\n");
    chmodSync(join(root, "release"), 0o755);
  }],
  ["lowercase make runner", (root) => write(root, "makefile", "release:\n\tserverless deploy --stage prod\n")],
  ["Serverless JSON config", (root) => write(root, "serverless.json", "{\"service\":\"prod-release\",\"provider\":{\"stage\":\"prod\"}}\n")],
  ["extensionless executable hook", (root) => {
    write(root, ".claude/hooks/release", "#!/usr/bin/env bash\nserverless deploy --stage prod\n");
    chmodSync(join(root, ".claude/hooks/release"), 0o755);
  }],
  ["control symlink", (root) => symlinkSync("check-production-deploy-gate.mjs", join(root, "scripts/release-link"))],
  ["unreviewed stage config", (root) => write(root, "config/database-url.qa.yml", "value: ${env:DATABASE_URL}\n")],
  ["local migration guard drift", (root) => append(root, "src/local-migration-guard.ts", "\n// weakened\n")],
  ["local migration config drift", (root) => append(root, "src/config.ts", "\n// alternate database source\n")],
  ["production migration handler drift", (root) => write(root, "src/migrate-handler.ts", "export async function handler() { throw new Error('unreviewed'); }\n")],
  ["Vitest config side effect", (root) => append(root, "vitest.config.ts", "\nthrow new Error('unreviewed config');\n")],
  ["alternate Vitest workspace config", (root) => write(root, "vitest.workspace.ts", "export default [];\n")],
  ["unreviewed test file", (root) => write(root, "tests/unreviewed.test.ts", "throw new Error('unreviewed test');\n")],
  ["reviewed migration drift", (root) => append(root, "database/migrations/001_create_admin_schema.sql", "\n-- unreviewed change\n")],
  ["unreviewed migration file", (root) => write(root, "database/migrations/013_unreviewed.sql", "SELECT 1;\n")]
];

for (const [name, mutate] of physicalFixtures) {
  const fixtureRoot = createFixture();
  try {
    mutate(fixtureRoot);
    if (validate(loadState(fixtureRoot)).length === 0) fail(`negative fixture '${name}' was accepted`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

console.log("Admin automated release entrypoints are allowlisted; stage/package paths are fail-closed.");

function loadState(root) {
  const workflowDirectory = join(root, ".github", "workflows");
  const workflows = Object.fromEntries(
    existsSync(workflowDirectory)
      ? readdirSync(workflowDirectory)
          .filter((name) => /\.ya?ml$/.test(name))
          .map((name) => [name, read(root, `.github/workflows/${name}`)])
      : []
  );
  const packageRaw = read(root, "package.json");
  const controlFiles = {
    ...readTree(root, "scripts"),
    ...readTree(root, ".claude/hooks", (_path, absolutePath) => isExecutable(absolutePath)),
    ...readTree(root, ".github/actions")
  };
  const rootEntries = readdirSync(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    const absolutePath = join(root, entry.name);
    const isRunner = rootRunnerNames.has(entry.name.toLowerCase());
    if (entry.isSymbolicLink()) {
      controlFiles[entry.name] = `symlink:${readlinkSync(absolutePath)}`;
    } else if (entry.isFile() && (isRunner || isExecutable(absolutePath))) {
      controlFiles[entry.name] = readFileSync(absolutePath, "utf8");
    }
  }

  return {
    workflows,
    serverless: read(root, "serverless.yml"),
    packageRaw,
    packageJson: JSON.parse(packageRaw),
    packageLock: read(root, "pnpm-lock.yaml"),
    settings: read(root, ".claude/settings.json"),
    ciConfig: read(root, "config/database-url.ci.yml"),
    prodConfig: read(root, "config/database-url.prod.yml"),
    stageConfigs: readdirSync(join(root, "config"))
      .filter((name) => /^database-url\..+\.ya?ml$/i.test(name))
      .sort(),
    controlFiles,
    serverlessConfigs: rootEntries
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => /^(?:serverless|sls)(?:-compose)?\.(?:ya?ml|json|[cm]?js|ts)$/i.test(name))
      .sort(),
    packageManagerConfigs: rootEntries
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter(isPackageManagerConfig)
      .sort(),
    testRunnerConfigs: rootEntries
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter(isTestRunnerConfig)
      .sort(),
    migrationFiles: readTree(root, "database/migrations"),
    runtimeFiles: {
      ...readTree(root, "src"),
      ...readTree(root, "tests"),
      "tsconfig.json": read(root, "tsconfig.json"),
      "vitest.config.ts": read(root, "vitest.config.ts")
    }
  };
}

function validate(state) {
  const errors = [];
  assertExactSet(errors, "workflow", Object.keys(state.workflows), Object.keys(expectedWorkflowHashes));
  for (const [name, expectedHash] of Object.entries(expectedWorkflowHashes)) {
    assertHash(errors, `.github/workflows/${name}`, state.workflows[name], expectedHash);
  }
  if (state.workflows["deploy-prod.yml"] !== expectedWorkflow) errors.push("production workflow must remain the exact fail-closed stub");

  assertExactSet(errors, "control file", Object.keys(state.controlFiles), Object.keys(expectedControlFileHashes));
  for (const [name, expectedHash] of Object.entries(expectedControlFileHashes)) {
    if (expectedHash) assertHash(errors, name, state.controlFiles[name], expectedHash);
  }
  assertExactSet(errors, "Serverless config", state.serverlessConfigs, expectedServerlessConfigs);
  assertExactSet(errors, "package-manager config", state.packageManagerConfigs, expectedPackageManagerConfigs);
  assertExactSet(errors, "stage config", state.stageConfigs, expectedStageConfigs);
  assertExactSet(errors, "test-runner config", state.testRunnerConfigs, expectedTestRunnerConfigs);
  assertHash(errors, "serverless.yml", state.serverless, expectedFileHashes["serverless.yml"]);
  assertHash(errors, "package.json", state.packageRaw, expectedFileHashes["package.json"]);
  assertHash(errors, "pnpm-lock.yaml", state.packageLock, expectedFileHashes["pnpm-lock.yaml"]);
  assertHash(errors, ".claude/settings.json", state.settings, expectedFileHashes[".claude/settings.json"]);
  assertExactSet(errors, "runtime file", Object.keys(state.runtimeFiles), Object.keys(expectedRuntimeFileHashes));
  for (const [name, expectedHash] of Object.entries(expectedRuntimeFileHashes)) {
    assertHash(errors, name, state.runtimeFiles[name], expectedHash);
  }
  assertExactSet(errors, "migration file", Object.keys(state.migrationFiles), Object.keys(expectedMigrationFileHashes));
  for (const [name, expectedHash] of Object.entries(expectedMigrationFileHashes)) {
    assertHash(errors, name, state.migrationFiles[name], expectedHash);
  }

  const uncommentedServerless = state.serverless.replace(/^\s*#.*$/gm, "");
  const stages = [...uncommentedServerless.matchAll(/^\s*stage:\s*(.+?)\s*$/gm)].map((match) => match[1]);
  if (stages.length !== 1 || stages[0] !== "${opt:stage}") errors.push("Serverless must contain exactly one mandatory stage declaration");
  const databases = [...uncommentedServerless.matchAll(/^\s*DATABASE_URL:\s*(.+?)\s*$/gm)].map((match) => match[1]);
  if (databases.length !== 1 || databases[0] !== "${file(./config/database-url.${self:provider.stage}.yml):value}") errors.push("database must resolve through the stage allowlist");
  if (state.ciConfig !== "value: ${env:DATABASE_URL}\n") errors.push("ci config must use explicit DATABASE_URL");
  if (state.prodConfig !== "value: ${ssm:/autonomia/prod/admin/database-url}\n") errors.push("prod config must use exclusively Admin SSM");

  assertExactSet(errors, "package script", Object.keys(state.packageJson.scripts ?? {}), Object.keys(expectedScripts));
  for (const [name, expectedValue] of Object.entries(expectedScripts)) {
    if (state.packageJson.scripts?.[name] !== expectedValue) errors.push(`package script '${name}' differs from the reviewed allowlist`);
  }
  return errors;
}

function createFixture() {
  const target = mkdtempSync(join(tmpdir(), "admin-deploy-gate-"));
  for (const path of [
    ".github/workflows",
    ".github/actions",
    ".claude/hooks",
    ".claude/settings.json",
    "scripts",
    "database/migrations",
    "src",
    "tests",
    "config",
    "package.json",
    "pnpm-lock.yaml",
    "serverless.yml",
    "tsconfig.json",
    "vitest.config.ts"
  ]) {
    const source = join(repositoryRoot, path);
    if (!existsSync(source)) continue;
    const destination = join(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }
  return target;
}

function readTree(root, directory, include = () => true) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return {};
  const values = {};
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    const absolutePath = join(entry.parentPath, entry.name);
    const key = relative(root, absolutePath).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      values[key] = `symlink:${readlinkSync(absolutePath)}`;
      continue;
    }
    if (!entry.isFile() || !include(key, absolutePath)) continue;
    values[key] = readFileSync(absolutePath, "utf8");
  }
  return values;
}

function isExecutable(path) {
  return (statSync(path).mode & 0o111) !== 0;
}

function isPackageManagerConfig(name) {
  return /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|bunfig\.toml|\.npmrc|\.pnpmfile\.[cm]?js|pnpmfile\.[cm]?js|pnpm-workspace\.ya?ml|\.yarnrc(?:\.ya?ml)?|\.pnp\.[cm]?js)$/i.test(name);
}

function isTestRunnerConfig(name) {
  return /^(?:(?:vitest|vite)\.config\.(?:ts|mts|cts|js|mjs|cjs)|vitest\.(?:workspace|projects)\.(?:ts|mts|cts|js|mjs|cjs|json))$/i.test(name);
}

function read(root, path) {
  return readFileSync(join(root, path), "utf8");
}

function write(root, path, value) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, value);
}

function append(root, path, value) {
  write(root, path, read(root, path) + value);
}

function replaceIn(root, path, before, after) {
  const current = read(root, path);
  if (!current.includes(before)) fail(`fixture could not find target in ${path}`);
  write(root, path, current.replace(before, after));
}

function mutatePackage(root, mutate) {
  const value = JSON.parse(read(root, "package.json"));
  mutate(value);
  write(root, "package.json", `${JSON.stringify(value, null, 2)}\n`);
}

function assertExactSet(errors, label, actualValues, expectedValues) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${label} set must match the reviewed allowlist`);
}

function assertHash(errors, name, value, expectedHash) {
  const actualHash = value === undefined ? "missing" : createHash("sha256").update(value).digest("hex");
  if (actualHash !== expectedHash) errors.push(`${name} differs from the reviewed allowlist`);
}

function fail(message) {
  console.error(`Deploy gate check failed: ${message}`);
  process.exit(1);
}
