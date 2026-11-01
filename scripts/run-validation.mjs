import { run } from "./lib/process.mjs";

const mode = process.argv[2] ?? "standard";
const root = new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const productionBuildEnv = {
  ...process.env,
  VITE_API_BASE_URL: "https://api.staging.darb.invalid",
  VITE_APP_ENV: "production",
  VITE_ENABLE_DEMO_FEATURES: "false",
  VITE_DEMO_ADMIN_PHONE: "",
  VITE_DEMO_ADMIN_PASSWORD: "",
  VITE_DEMO_RESET_KEY: ""
};

const groups = {
  backend: [
    ["npm", ["run", "prisma:validate"]],
    ["npm", ["run", "prisma:generate"]],
    ["npm", ["run", "typecheck"]],
    ["npm", ["run", "test"]],
    ["npm", ["run", "build"], { env: productionBuildEnv }]
  ],
  admin: [
    ["npm", ["run", "typecheck:admin"]],
    ["npm", ["run", "test:admin"]],
    ["npm", ["run", "build:admin"], { env: productionBuildEnv }]
  ],
  security: [
    ["npm", ["run", "ci:workflows"]],
    ["npm", ["run", "security:scan"]],
    ["npm", ["run", "security:audit"]],
    ["npm", ["run", "test:tooling"]]
  ],
  mobile: [
    ["flutter", ["pub", "get"], { cwd: `${root}/apps/mobile` }],
    ["flutter", ["gen-l10n"], { cwd: `${root}/apps/mobile` }],
    ["dart", ["format", "--set-exit-if-changed", "."], { cwd: `${root}/apps/mobile` }],
    ["flutter", ["analyze"], { cwd: `${root}/apps/mobile` }],
    ["flutter", ["test"], { cwd: `${root}/apps/mobile` }]
  ]
};

const selected =
  mode === "backend" ? ["backend"] :
  mode === "admin" ? ["admin"] :
  mode === "security" ? ["security"] :
  mode === "all" ? ["backend", "admin", "security", "mobile"] :
  mode === "standard" ? ["backend", "admin", "security"] : null;

if (!selected) {
  console.error("Usage: node scripts/run-validation.mjs backend|admin|security|standard|all");
  process.exit(2);
}

for (const group of selected) {
  for (const [command, args, options] of groups[group]) {
    console.log(`\n[validate:${group}] ${command} ${args.join(" ")}`);
    run(command, args, { cwd: root, ...options });
  }
}

console.log(`\nValidation mode '${mode}' passed.`);
