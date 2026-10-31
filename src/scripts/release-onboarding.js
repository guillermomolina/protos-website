// WEB012: version-independent GitHub release onboarding.
const RELEASES_API =
  'https://api.github.com/repos/guillermomolina/protos/releases?per_page=10';

const DOWNLOAD_BASE =
  'https://github.com/guillermomolina/protos/releases/download';

const discoverTag = [
  `TAG="$(curl -fsSL '${RELEASES_API}' |`,
  `  python3 -c 'import json,re,sys; data=json.load(sys.stdin); candidates=[r for r in data if r.get("prerelease") is True and r.get("draft") is False and isinstance(r.get("tag_name"),str) and isinstance(r.get("published_at"),str) and re.fullmatch(r"v[0-9]+\\.[0-9]+\\.[0-9]+",r["tag_name"])]; print(max(candidates,key=lambda r:r["published_at"])["tag_name"])')"`,
].join('\n');

function commands(kind) {
  if (kind !== 'native' && kind !== 'portable') {
    throw new TypeError('Unsupported Protos distribution');
  }

  const native = kind === 'native';

  const archive = native
    ? 'protos-$VERSION-native-linux-x86_64.zip'
    : 'protos-$VERSION-posix-jvm.zip';

  const directory = native
    ? '${ZIP%.zip}'
    : 'protos-$VERSION';

  const runtimeHint = native ? [] : [
    '# Portable JVM: use the GraalVM/JDK required by this release.',
    '# Set JAVA_HOME to its installation directory before running,',
    '# or select the supported Java through PROTOS_JAVA or PATH.',
    '# The launcher validates the runtime against RUNTIME.txt.',
  ];

  return [
    ...runtimeHint,
    discoverTag,
    'if [ -n "$TAG" ]; then',
    '  VERSION="${TAG#v}"',
    `  ZIP="${archive}"`,
    `  curl -fLO "${DOWNLOAD_BASE}/$TAG/$ZIP" &&`,
    `  curl -fLO "${DOWNLOAD_BASE}/$TAG/$ZIP.sha256" &&`,
    '  sha256sum -c "$ZIP.sha256" &&',
    '  unzip "$ZIP" &&',
    `  cd "${directory}" &&`,
    '  ./bin/protos --version &&',
    `  ./bin/protos -e 'print("Hello, Protos!")'`,
    'else',
    `  printf '%s\\n' 'Could not resolve the latest Protos prerelease.'`,
    'fi',
  ].join('\n');
}

export const nativeFirstRun = commands('native');
export const portableFirstRun = commands('portable');

export function wireOnboardingCopy(
  documentRoot,
  clipboard = globalThis.navigator?.clipboard,
) {
  for (const button of documentRoot.querySelectorAll(
    '[data-copy-onboarding]',
  )) {
    button.addEventListener('click', async () => {
      const kind = button.getAttribute('data-copy-onboarding');

      if (kind !== 'native' && kind !== 'portable') return;

      const source = documentRoot.querySelector(
        `[data-first-run="${kind}"]`,
      );

      const status = button.parentElement?.querySelector(
        '[data-copy-status]',
      );

      if (!source || !status) return;

      try {
        if (!clipboard?.writeText) {
          throw new Error('Clipboard unavailable');
        }

        await clipboard.writeText(source.textContent);
        status.textContent = 'Copied';
      } catch {
        status.textContent =
          'Select the commands and copy them manually.';
      }
    });
  }
}
