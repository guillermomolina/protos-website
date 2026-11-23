// WEB012: Delegate Native release selection, checksums and installation
// to the official installer maintained in guillermomolina/protos.
const INSTALLER_URL =
  'https://raw.githubusercontent.com/guillermomolina/protos/main/dist/install.sh';

export const nativeFirstRun = [
  `curl -fsSLo protos-install.sh '${INSTALLER_URL}'`,
  'sh protos-install.sh',
  '"$HOME/.local/bin/protos" --version',
  `"$HOME/.local/bin/protos" -e 'print("Hello, Protos!")'`,
].join('\n');

export function wireOnboardingCopy(
  documentRoot,
  clipboard = globalThis.navigator?.clipboard,
) {
  for (const button of documentRoot.querySelectorAll(
    '[data-copy-onboarding]',
  )) {
    button.addEventListener('click', async () => {
      const kind = button.getAttribute('data-copy-onboarding');

      if (kind !== 'native') return;

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
