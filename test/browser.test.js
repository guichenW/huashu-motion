import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CHROME, chromeCandidates, chromeVersion, findChrome } from '../cli/lib/browser.js';

const fake = (name) => { const f = join(mkdtempSync(join(tmpdir(), 'om-br-')), name); writeFileSync(f, '#!/bin/sh\necho "Fake Chrome 123.4.5.6"\n'); chmodSync(f, 0o755); return f; };

test('browser: OM_CHROME first, then installed apps in order; a missing OM_CHROME falls through', () => {
  const a = fake('a'), b = fake('b'), home = mkdtempSync(join(tmpdir(), 'om-home-'));
  assert.equal(findChrome({ env: { OM_CHROME: a }, apps: [b], home }), a);
  assert.equal(findChrome({ env: {}, apps: ['/nope', b, a], home }), b);
  assert.equal(findChrome({ env: { OM_CHROME: '/nope' }, apps: [b], home }), b);
  assert.equal(findChrome({ env: {}, apps: ['/nope'], home }), null);
  assert.deepEqual(chromeCandidates({ env: { OM_CHROME: a }, apps: [b], home }).map((c) => c.source), ['OM_CHROME', 'installed']);
});

test('browser: only a browser that is already installed is used — nothing is downloaded, no other cache is borrowed', () => {
  const home = mkdtempSync(join(tmpdir(), 'om-home-'));
  const dir = join(home, '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell', 'mac_arm-1', 'chrome-headless-shell-mac-arm64');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'chrome-headless-shell'), '');
  assert.equal(findChrome({ env: { HOME: home }, apps: [] }), null);
  assert.match(NO_CHROME, /install Google Chrome/);
});

test('browser: version is read from --version', () => {
  // Windows cannot execute a POSIX shebang fixture. Inject only the process
  // runner there; still verify --version arguments and the four-part parser.
  const exe = fake('v');
  const options = process.platform === 'win32' ? { run: (file, args) => {
    assert.equal(file, exe); assert.deepEqual(args, ['--version']);
    return { stdout: 'Fake Chrome 123.4.5.6\n' };
  } } : undefined;
  assert.equal(chromeVersion(exe, options), '123.4.5.6');
});
