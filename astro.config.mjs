import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const configuredProtosCache = process.env.PROTOS_SOURCE_CACHE;
const protosCache = configuredProtosCache
  ? (isAbsolute(configuredProtosCache)
      ? configuredProtosCache
      : resolve(configuredProtosCache))
  : resolve('.protos-source');
const canonicalProtosGrammar = JSON.parse(
  readFileSync(
    resolve(
      protosCache,
      'editors/vscode/syntaxes/protos.tmLanguage.json',
    ),
    'utf8',
  ),
);

// Shiki's language id must match fenced blocks (`protos`). This adapter changes
// only renderer registration metadata; lexical scopes and patterns remain the
// exact TextMate asset owned by the locked Protos source revision.
const protosShikiGrammar = {
  ...canonicalProtosGrammar,
  name: 'protos',
  aliases: ['Protos'],
};

// Presentation-only EBNF highlighting for the canonical specification.
// This is not a Protos grammar and does not define which EBNF dialect the
// specification accepts; it only prevents `ebnf` Markdown fences from being
// rendered as an unsupported language.
const ebnfShikiGrammar = {
  name: 'ebnf',
  scopeName: 'source.ebnf',
  aliases: ['EBNF'],
  patterns: [
    { include: '#comments' },
    {
      name: 'string.quoted.double.ebnf',
      begin: '"',
      end: '"',
      patterns: [
        { name: 'constant.character.escape.ebnf', match: '\\\\.' },
      ],
    },
    {
      name: 'string.quoted.single.ebnf',
      begin: "'",
      end: "'",
      patterns: [
        { name: 'constant.character.escape.ebnf', match: '\\\\.' },
      ],
    },
    {
      name: 'keyword.operator.ebnf',
      match: '::=|:=|=|\\\\|',
    },
    {
      name: 'punctuation.definition.ebnf',
      match: '[{}\\\\[\\\\](),;]',
    },
    {
      name: 'constant.numeric.ebnf',
      match: '\\\\b[0-9]+\\\\b',
    },
    {
      name: 'variable.other.ebnf',
      match: '[A-Za-z_][A-Za-z0-9_-]*',
    },
  ],
  repository: {
    comments: {
      patterns: [
        {
          name: 'comment.block.ebnf',
          begin: '\\\\(\\\\*',
          end: '\\\\*\\\\)',
        },
        {
          name: 'comment.line.double-slash.ebnf',
          match: '//.*$',
        },
      ],
    },
  },
};

export default defineConfig({
  site: 'https://protos.guillermolina.com',
  integrations: [
    starlight({
      title: 'Protos',
      expressiveCode: {
        shiki: {
          langs: [protosShikiGrammar, ebnfShikiGrammar],
        },
      },
      description:
        'Protos is an experimental prototype-based programming language designed from first principles.',
      favicon: '/favicon.ico',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/png',
            sizes: '32x32',
            href: '/favicon-32x32.png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/png',
            sizes: '16x16',
            href: '/favicon-16x16.png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'apple-touch-icon',
            sizes: '180x180',
            href: '/apple-touch-icon.png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'manifest',
            href: '/site.webmanifest',
          },
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/guillermomolina/protos',
        },
      ],
      sidebar: [
        {
          label: 'Learn',
          items: [{ autogenerate: { directory: 'learn' } }],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
        {
          label: 'Design',
          items: [{ autogenerate: { directory: 'design' } }],
        },
        {
          label: 'Community',
          items: [{ autogenerate: { directory: 'community' } }],
        },
      ],
    }),
  ],
});
