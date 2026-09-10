import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://protos.guillermolina.com',
  integrations: [
    starlight({
      title: 'Protos',
      description:
        'Protos is an experimental prototype-based programming language designed from first principles.',
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
