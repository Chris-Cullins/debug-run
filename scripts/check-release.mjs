import { appendFile, readFile } from 'node:fs/promises';

const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
// Query the existing package, so network/auth failures and a missing package fail
// closed instead of being mistaken for an unpublished version.
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  throw new Error(`Cannot check npm release: HTTP ${response.status}`);
}
const metadata = await response.json();
if (!metadata.versions || typeof metadata.versions !== 'object') {
  throw new Error('npm returned invalid package metadata');
}
const shouldPublish = !Object.hasOwn(metadata.versions, version);
console.log(
  `${name}@${version}: ${shouldPublish ? 'ready to publish' : 'already published; skipping'}`
);
await appendFile(process.env.GITHUB_OUTPUT, `should_publish=${shouldPublish}\n`);
