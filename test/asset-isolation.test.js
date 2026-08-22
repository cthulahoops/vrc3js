import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function clientSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await clientSourceFiles(url));
    else if (/\.(?:css|js)$/.test(entry.name)) files.push(url);
  }
  return files;
}

test('client static assets do not reference remote hosts', async () => {
  const files = await clientSourceFiles(new URL('../src/', import.meta.url));
  const sources = await Promise.all(files.map(source => readFile(source, 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /https?:\/\/|url\(\s*['"]?\/\//i);
  }
});
