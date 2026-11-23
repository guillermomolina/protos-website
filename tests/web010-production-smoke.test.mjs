import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const make = readFileSync(new URL('../Makefile', import.meta.url), 'utf8');
const smoke = readFileSync(
  new URL('../scripts/smoke-production.py', import.meta.url), 'utf8'
);

test('WEB010 make serve waits for a real HTTP readiness response', () => {
  assert.match(make, /serve: image/);
  assert.match(make, /curl --fail --silent --max-time 3 -o \/dev\/null/);
  assert.match(make, /WEB010_SERVE_READY=PASS/);
  assert.match(make, /WEB010_SERVE_READY=FAIL/);
  assert.doesNotMatch(make, /run --rm -d/);
  assert.match(make, /\$\(CONTAINER_ENGINE\) logs --tail 100/);
});

test('WEB010 smoke validates live source identity and separate D064 provenance', () => {
  assert.match(make, /python3 scripts\/smoke-production\.py/);
  assert.match(smoke, /documentation-snapshot/);
  assert.match(smoke, /documentation-catalog/);
  assert.match(smoke, /canonical-document-catalog/);
  assert.match(smoke, /protos-d064-publication/);
  assert.match(smoke, /catalog\.get\("revision"\) == catalog_snapshot\["revision"\]/);
  assert.match(smoke, /document\["provenance"\]\.get\("revision"\) == publication\["sourceRevision"\]/);
});
