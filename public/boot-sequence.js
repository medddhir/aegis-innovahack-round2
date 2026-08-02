const SESSION_KEY = 'aegis-intro-seen';
const MAX_DURATION_MS = 1_350;

export function shouldShowBoot({ search = '', seen = false } = {}) {
  return new URLSearchParams(search).get('intro') === '1' || !seen;
}

export function initBootSequence({ documentRef = document, windowRef = window } = {}) {
  const root = documentRef.querySelector('#bootSequence');
  if (!root) return Object.freeze({ shown: false, skip() {} });
  let seen = false;
  try { seen = windowRef.sessionStorage.getItem(SESSION_KEY) === '1'; } catch { /* Restricted storage shows the bounded sequence once. */ }
  const show = shouldShowBoot({ search: windowRef.location.search, seen });
  if (!show) {
    root.hidden = true;
    documentRef.documentElement.classList.add('aegis-intro-seen');
    return Object.freeze({ shown: false, skip() {} });
  }

  const previousFocus = documentRef.activeElement;
  const reduced = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  let complete = false;
  documentRef.body.classList.add('boot-active');
  documentRef.documentElement.classList.remove('aegis-intro-seen');
  root.classList.add(reduced ? 'boot-reduced' : 'boot-running');

  function finish({ restoreFocus = false } = {}) {
    if (complete) return;
    complete = true;
    windowRef.clearTimeout(timer);
    documentRef.removeEventListener('keydown', keyHandler, true);
    root.classList.add('boot-complete');
    try { windowRef.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* The sequence remains time-bounded without storage. */ }
    const removeDelay = reduced ? 0 : 180;
    windowRef.setTimeout(() => {
      root.hidden = true;
      documentRef.body.classList.remove('boot-active');
      documentRef.documentElement.classList.add('aegis-intro-seen');
      if (restoreFocus) {
        const target = previousFocus?.isConnected && previousFocus !== documentRef.body ? previousFocus : documentRef.querySelector('#launchJudgeMode');
        target?.focus?.({ preventScroll: true });
      }
    }, removeDelay);
  }

  const skip = () => finish({ restoreFocus: true });
  root.querySelector('#bootSkip')?.addEventListener('click', skip);
  const keyHandler = event => {
    if (complete || !['Enter', ' ', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    skip();
  };
  documentRef.addEventListener('keydown', keyHandler, true);
  root.addEventListener('click', event => { if (event.target === root) skip(); });
  timer = windowRef.setTimeout(() => finish(), reduced ? 20 : MAX_DURATION_MS);
  return Object.freeze({ shown: true, skip, isComplete: () => complete });
}

if (typeof document !== 'undefined') initBootSequence();

export { MAX_DURATION_MS, SESSION_KEY };
