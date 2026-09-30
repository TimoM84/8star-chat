"use strict";
// Configuration consistency: environment variables, Compose file, Dockerfile.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const server = read("server.js"),
  compose = read("compose.yaml"),
  envExample = read(".env.example"),
  readme = read("README.md"),
  dockerfile = read("Dockerfile"),
  pkg = JSON.parse(read("package.json"));

const envVars = [
  ...new Set(
    [...server.matchAll(/process\.env\.([A-Z0-9_]+)/g), ...server.matchAll(/envNumber\("([A-Z0-9_]+)"/g)].map(
      (m) => m[1],
    ),
  ),
];
const composeEnv = [...compose.matchAll(/^\s{6}([A-Z0-9_]+):/gm)].map((m) => m[1]);

test("every environment variable the server reads is documented", () => {
  for (const name of envVars) assert.ok(readme.includes(name), name + " missing in README");
});

test("Compose only sets variables the server actually reads", () => {
  assert.ok(composeEnv.length > 5);
  for (const name of composeEnv)
    assert.ok(envVars.includes(name), name + " is set in compose.yaml but unused");
  for (const line of envExample.split("\n").filter((l) => /^[A-Z]/.test(l)))
    assert.ok(envVars.includes(line.split("=")[0]), line + " in .env.example is unused");
});

test("Compose keeps the existing data volume and does not rename the project", () => {
  assert.match(compose, /- 8star_chat_data:\/data/);
  assert.match(compose, /^volumes:\n\s+8star_chat_data:/m);
  assert.doesNotMatch(compose, /^name:/m, "a top-level name would create a new, empty volume");
  assert.match(compose, /"9876:3000"/);
  assert.match(compose, new RegExp("image: 8star-chat:" + pkg.version.replaceAll(".", "\\.")));
});

test("Dockerfile ships all runtime files and runs as non-root", () => {
  assert.match(dockerfile, /COPY server\.js/);
  assert.match(dockerfile, /COPY public \.\/public/);
  assert.match(dockerfile, /USER app/);
  assert.match(read("public/index.html"), /i18n-core\.js[\s\S]*i18n\.js[\s\S]*app\.js/);
});

test("docker compose accepts the Compose file", (t) => {
  let docker = "";
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    docker = "docker";
  } catch {}
  if (!docker) return t.skip("docker compose is not installed");
  const out = execFileSync(
    "docker",
    ["compose", "-f", path.join(root, "compose.yaml"), "config", "--quiet"],
    {
      env: { ...process.env, ADMIN_PASSWORD: "only-for-validation" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(String(out).trim(), "");
});
