import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';

const ARTICLE_NAME =
  /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;

// Remove only recognized output from the former materializer.
export function retireGeneratedNews({ root, checkOnly = false }) {
  const directory = join(
    root, 'src/content/docs/community/news',
  );
  const manifest = join(
    root, 'src/generated/protos-news.json',
  );

  const hasDirectory = existsSync(directory);
  const hasManifest = existsSync(manifest);
  const files = [];

  // Validate all candidates before deleting any file.
  if (hasDirectory) {
    if (!lstatSync(directory).isDirectory()) {
      throw new Error('Unexpected legacy news directory type');
    }

    const items = readdirSync(
      directory, { withFileTypes: true },
    );

    for (const item of items) {
      if (
        !item.isFile() ||
        (
          item.name !== 'index.md' &&
          !ARTICLE_NAME.test(item.name)
        )
      ) {
        throw new Error(
          `Unexpected legacy news file: ${item.name}`,
        );
      }

      files.push(item.name);
    }
  }

  if (hasManifest && !lstatSync(manifest).isFile()) {
    throw new Error('Unexpected legacy news manifest type');
  }

  if (!hasDirectory && !hasManifest) return;

  if (checkOnly) {
    throw new Error(
      'Retired news output still exists; run source preparation to clean it',
    );
  }

  for (const name of files) {
    rmSync(join(directory, name));
  }

  if (hasDirectory) rmdirSync(directory);
  if (hasManifest) rmSync(manifest);

  console.log('PROTOS_LEGACY_NEWS_RETIRED');
}
