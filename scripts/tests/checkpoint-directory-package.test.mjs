import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../..', import.meta.url));
test('API runtime layout starts with only the explicitly packaged public directory manifest', () => {
  const docker = readFileSync(join(root, 'apps/api/Dockerfile'), 'utf8');
  const parent = join(root, '.staging-data'); mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(join(parent, 'directory-package-'));
  try {
    const api = join(temporary, 'apps/api'); mkdirSync(api, { recursive: true });
    // Security CI intentionally runs tooling before building the API. Compile
    // only the real import boundary here; no generated Prisma or build needed.
    for (const relative of ['services/checkpointDirectory', 'middleware/error', 'maps/contracts']) {
      const source = readFileSync(join(root, 'apps/api/src', relative + '.ts'), 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const destination = join(api, 'dist', relative + '.js'); mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, output);
    }
    cpSync(join(root, 'apps/api/package.json'), join(api, 'package.json'));
    const name = 'checkpoint-directory.v1.manifest.json';
    const copiesBuild = docker.split(/\r?\n/).some(line => line === `COPY apps/api/data/${name} apps/api/data/${name}`);
    const copiesRuntime = docker.split(/\r?\n/).some(line => line === `COPY --from=build --chown=node:node /workspace/apps/api/data/${name} /app/apps/api/data/${name}`);
    if (copiesBuild && copiesRuntime) {
      mkdirSync(join(api, 'data')); cpSync(join(root, 'apps/api/data', name), join(api, 'data', name));
    }
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./apps/api/dist/services/checkpointDirectory.js')"],
      { cwd: temporary, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(child.status, 0, 'Disabled directory service must import in the actual runtime file layout: ' + child.stderr);
    assert(copiesBuild && copiesRuntime, 'Both stages must explicitly copy the public manifest');
    assert(existsSync(join(api, 'data', name)));
    assert(!docker.includes('COPY apps/api/data apps/api/data'), 'Never package the entire data folder');
  } finally {
    assert(resolve(temporary).startsWith(resolve(parent) + (process.platform === 'win32' ? '\\' : '/')));
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Docker context excludes local research inputs and includes only the public data manifest', () => {
  const rules = readFileSync(join(root, '.dockerignore'), 'utf8').split(/\r?\n/);
  for (const required of ['.staging-data', '.superpowers', '**/Masari_AweenRayeh_173_Directory_Import.json',
    'apps/api/data/*', '!apps/api/data/checkpoint-directory.v1.manifest.json']) {
    assert(rules.includes(required), 'Local research or future unapproved data must not enter Docker context');
  }
});
