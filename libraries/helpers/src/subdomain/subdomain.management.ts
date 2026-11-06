import { parse } from 'tldts';

/**
 * Cookie Domain attribute for Postiz auth cookies.
 * Default (upstream): eTLD+1 so platform.postiz.com shares cookies with postiz.com.
 * COOKIE_HOST_ONLY=true: omit Domain (host-only). Required when Postiz shares a
 * parent domain with another product (e.g. postiz.example.com beside
 * plane.example.com) so the JWT is not sent to siblings.
 * COOKIE_DOMAIN: explicit Domain value; "host" / "none" also means host-only.
 */
export function getCookieUrlFromDomain(domain: string): string | undefined {
  if (process.env.COOKIE_HOST_ONLY === 'true') {
    return undefined;
  }
  const explicit = process.env.COOKIE_DOMAIN?.trim();
  if (explicit) {
    if (explicit === 'host' || explicit === 'none') {
      return undefined;
    }
    return explicit.startsWith('.') ? explicit : '.' + explicit;
  }
  const url = parse(domain);
  return url.domain ? '.' + url.domain : url.hostname || undefined;
}
