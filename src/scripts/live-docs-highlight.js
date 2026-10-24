// The Markdown renderer has already sanitized the source before this runs.
// Tokens are inserted as text nodes; no highlighted HTML is interpreted.

const MAX_CODE_LENGTH = 32768;
const MAX_BLOCKS = 64;

let highlighterPromise;

export function getProtosHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('@shikijs/themes/github-dark'),
      import('./generated/protos-grammar.js'),
    ]).then(([
      { createHighlighterCore },
      { createJavaScriptRegexEngine },
      theme,
      grammar,
    ]) => createHighlighterCore({
      themes: [theme.default],
      langs: [grammar.default],
      engine: createJavaScriptRegexEngine(),
    }));
  }

  return highlighterPromise;
}

export async function highlightProtosFences(article) {
  if (!article || typeof article.querySelectorAll !== 'function') {
    return 0;
  }

  const blocks = Array.from(
    article.querySelectorAll('pre > code.language-protos'),
  ).slice(0, MAX_BLOCKS).filter(
    code => typeof code.textContent === 'string' &&
      code.textContent.length <= MAX_CODE_LENGTH,
  );

  if (!blocks.length) return 0;

  const highlighter = await getProtosHighlighter();
  let highlighted = 0;

  for (const code of blocks) {
    // An asynchronous fetch may have replaced the displayed document.
    if (code.isConnected === false) continue;

    const source = code.textContent;
    const { tokens } = highlighter.codeToTokens(source, {
      lang: 'protos',
      theme: 'github-dark',
    });

    const doc = code.ownerDocument;
    const fragment = doc.createDocumentFragment();

    tokens.forEach((line, index) => {
      if (index > 0) {
        fragment.append(doc.createTextNode('\n'));
      }

      for (const token of line) {
        const span = doc.createElement('span');
        span.textContent = token.content;

        // Accept only literal hex colors from the installed theme.
        if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(token.color)) {
          span.style.color = token.color;
        }

        fragment.append(span);
      }
    });

    // Preserve a final newline if Shiki omits the empty final line.
    if (
      source.endsWith('\n') &&
      fragment.textContent === source.slice(0, -1)
    ) {
      fragment.append(doc.createTextNode('\n'));
    }

    // Highlighting must never change even one source character.
    if (fragment.textContent !== source) continue;

    code.replaceChildren(fragment);
    highlighted++;
  }

  return highlighted;
}
