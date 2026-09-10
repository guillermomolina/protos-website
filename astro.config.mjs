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

export default defineConfig({
  site: 'https://protos.guillermolina.com',
  integrations: [
    starlight({
      title: 'Protos',
      expressiveCode: {
        shiki: {
          langs: [protosShikiGrammar],
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
