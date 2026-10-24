import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import grammar, {
  PROTOS_GRAMMAR_REVISION,
} from '../src/scripts/generated/protos-grammar.js';

import {
  getProtosHighlighter,
  highlightProtosFences,
} from '../src/scripts/live-docs-highlight.js';

const lock = JSON.parse(
  readFileSync(
    new URL('../protos-vscode-source.lock.json', import.meta.url),
    'utf8',
  ),
);

test('browser grammar preserves the locked canonical patterns', () => {
  const cache = process.env.PROTOS_VSCODE_SOURCE_CACHE
    ? resolve(process.env.PROTOS_VSCODE_SOURCE_CACHE)
    : '/tmp/protos-website-vscode-source';

  const canonical = JSON.parse(
    readFileSync(
      resolve(cache, 'syntaxes/protos.tmLanguage.json'),
      'utf8',
    ),
  );

  assert.equal(PROTOS_GRAMMAR_REVISION, lock.revision);
  assert.equal(grammar.name, 'protos');
  assert.equal(grammar.scopeName, canonical.scopeName);
  assert.deepEqual(grammar.patterns, canonical.patterns);
  assert.deepEqual(grammar.repository, canonical.repository);
});

test('Shiki highlights Protos with distinct token colors', async () => {
  const highlighter = await getProtosHighlighter();
  const source = 'true 123 "hello" // comment';

  const { tokens } = highlighter.codeToTokens(source, {
    lang: 'protos',
    theme: 'github-dark',
  });

  const flattened = tokens.flat();

  assert.equal(
    flattened.map(token => token.content).join(''),
    source,
  );

  const colors = new Set(
    flattened.map(token => token.color).filter(Boolean),
  );

  assert.ok(colors.size > 1);
});

test('highlighter is cached per browser module', async () => {
  const first = await getProtosHighlighter();
  const second = await getProtosHighlighter();

  assert.strictEqual(first, second);
});

test('empty and oversized code blocks require no highlighting', async () => {
  assert.equal(
    await highlightProtosFences({
      querySelectorAll: () => [],
    }),
    0,
  );

  assert.equal(
    await highlightProtosFences({
      querySelectorAll: () => [{
        textContent: 'x'.repeat(32769),
      }],
    }),
    0,
  );
});

test('colored DOM preserves unsafe-looking source as inert text', async () => {
  const createdElements = [];

  const doc = {
    createDocumentFragment() {
      return {
        nodes: [],
        append(node) {
          this.nodes.push(node);
        },
        get textContent() {
          return this.nodes
            .map(node => node.textContent)
            .join('');
        },
      };
    },

    createTextNode(value) {
      return {
        nodeType: 3,
        textContent: value,
      };
    },

    createElement(tag) {
      createdElements.push(tag);

      return {
        tagName: tag,
        textContent: '',
        style: {},
      };
    },
  };

  const source = 'true "<script>alert(1)</script>" // inert';

  const code = {
    ownerDocument: doc,
    isConnected: true,
    textContent: source,
    replacement: null,

    replaceChildren(fragment) {
      this.replacement = fragment;
      this.textContent = fragment.textContent;
    },
  };

  const article = {
    querySelectorAll(selector) {
      assert.equal(selector, 'pre > code.language-protos');
      return [code];
    },
  };

  const count = await highlightProtosFences(article);

  assert.equal(count, 1);
  assert.equal(code.textContent, source);
  assert.equal(code.replacement.textContent, source);
  assert.ok(createdElements.length > 0);
  assert.ok(createdElements.every(tag => tag === 'span'));
});
