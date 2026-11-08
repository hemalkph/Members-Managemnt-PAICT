/**
 * Where to send someone after an email link: only a page inside this app.
 * The value is resolved the way the browser will (backslashes become slashes,
 * tabs and newlines are dropped), so "/\evil.com" or "/<tab>/evil.com" can't
 * turn into another website. Anything else becomes "/".
 */
export function safeNext(value: string | null, base: string): string {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const here = new URL(base);
    const url = new URL(value, here);
    // A path that normalises to "//host" (e.g. "/.//host") would be read as another website.
    if (url.origin !== here.origin || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
