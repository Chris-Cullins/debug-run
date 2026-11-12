import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { x } from 'tar';

// Test the actual tarball outside the checkout, without access to its node_modules.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'debug-run-package-'));
const skills = ['DOTNET.md', 'PYTHON.md', 'SKILL.md', 'TYPESCRIPT.md'];

try {
  const output = execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'pack',
      '--json',
      '--foreground-scripts=false',
      '--pack-destination',
      directory,
    ],
    { cwd: root, encoding: 'utf8' }
  );
  const [packed] = JSON.parse(output);
  assert.deepEqual(
    packed.files.map(({ path }) => path).sort(),
    [
      ...skills.map((file) => `.claude/skills/debug-run/${file}`),
      'README.md',
      'dist/index.cjs',
      'package.json',
    ].sort(),
    'The package must contain only the CLI, skill docs, README, and manifest'
  );

  await x({ file: join(directory, packed.filename), cwd: directory });
  const cli = join(directory, 'package', 'dist', 'index.cjs');
  const run = (...args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: directory,
      encoding: 'utf8',
    });
  assert.equal(run('--version').trim(), packed.version);
  assert.match(run('--help'), /Usage: debug-run/);
  const destination = join(directory, 'installed-skill');
  run('install-skill', '--dir', destination);
  for (const file of skills) {
    assert.equal(
      await readFile(join(destination, 'debug-run', file), 'utf8'),
      await readFile(join(root, '.claude', 'skills', 'debug-run', file), 'utf8')
    );
  }
  console.log(
    `Package smoke test passed for ${packed.name}@${packed.version} (${packed.entryCount} files)`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
