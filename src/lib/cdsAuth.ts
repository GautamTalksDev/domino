// Trusting CDS clients (CDS Hooks 2.0, "Trusting CDS Clients"): an EHR signs each call with a short-lived JWT in the
// Authorization header (ES384 or RS384), and the service checks it against the EHR's published keys (JWKS).
//
// Domino enforces this when DOMINO_CDS_ISSUERS names the EHRs it trusts, as JSON from issuer to its JWKS, either a URL
// or the key set itself:
//   DOMINO_CDS_ISSUERS={"https://sandbox.cds-hooks.org":"https://sandbox.cds-hooks.org/.well-known/jwks.json"}
// Then every call needs a valid token: a trusted issuer, a known key, a good signature, `aud` equal to the service URL,
// not expired (five minutes at most, a minute of clock skew), and a `jti` not seen before. Without the variable the
// service runs in open demo mode, as the docs and /ehr say.
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export class CdsAuthError extends Error {}

type Jwks = { keys: (JsonWebKey & { kid?: string; alg?: string })[] };

const ALGS: Record<string, { hash: string; ec: boolean }> = {
  ES384: { hash: 'sha384', ec: true },
  RS384: { hash: 'sha384', ec: false },
  ES256: { hash: 'sha256', ec: true },
  RS256: { hash: 'sha256', ec: false },
};

const MAX_LIFETIME_S = 300;
const SKEW_S = 60;

/** Is the service checking EHR tokens? Any non-empty DOMINO_CDS_ISSUERS turns it on; a bad value refuses every call. */
export const cdsAuthEnforced = () => !!process.env.DOMINO_CDS_ISSUERS?.trim();

function issuers(): Record<string, string | Jwks> | null {
  const raw = process.env.DOMINO_CDS_ISSUERS?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CdsAuthError('DOMINO_CDS_ISSUERS is not valid JSON, so no EHR is trusted.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length)
    throw new CdsAuthError('DOMINO_CDS_ISSUERS must map each trusted issuer to its JWKS, so no EHR is trusted.');
  // The audience check needs this deployment's own URL, not one derived from a request's Host header.
  if (!process.env.DOMINO_SITE_URL && !process.env.VERCEL_PROJECT_PRODUCTION_URL)
    throw new CdsAuthError('Set DOMINO_SITE_URL so EHR tokens can be checked against this service’s URL.');
  return parsed as Record<string, string | Jwks>;
}

const g = globalThis as unknown as { __domino_jwks?: Map<string, { at: number; jwks: Jwks }>; __domino_jti?: Map<string, number> };
const jwksCache = (g.__domino_jwks ??= new Map());
const seen = (g.__domino_jti ??= new Map());

async function keysFor(iss: string, source: string | Jwks, fresh = false): Promise<Jwks> {
  if (typeof source !== 'string') return source;
  const hit = jwksCache.get(source);
  // A key id not in the cached set may be a rotated key: refetch, at most once a minute per issuer.
  if (hit && (fresh ? Date.now() - hit.at < 60_000 : Date.now() - hit.at < 10 * 60_000)) return hit.jwks;
  const res = await fetch(source, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new CdsAuthError(`Could not fetch the keys for ${iss}.`);
  const jwks = (await res.json()) as Jwks;
  if (!Array.isArray(jwks?.keys)) throw new CdsAuthError(`The keys for ${iss} are not a JWK set.`);
  jwksCache.set(source, { at: Date.now(), jwks });
  return jwks;
}

const b64json = (part: string) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CdsAuthError('The token is malformed.');
  }
};

/**
 * Verify the EHR's bearer token for a call to one of `audiences` (the service URL). Returns the issuer when enforcement is on and
 * the token is valid, null when enforcement is off; throws CdsAuthError otherwise.
 */
export async function verifyCdsToken(authorization: string | null, audiences: string[]): Promise<string | null> {
  const trusted = issuers();
  if (!trusted) return null;
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization?.trim() ?? '');
  if (!m || authorization!.length > 8192) throw new CdsAuthError('A signed bearer token from a trusted EHR is required.');
  const [, h, p, sig] = m;
  const header = b64json(h);
  const claims = b64json(p);
  const alg = ALGS[String(header.alg)];
  if (!alg) throw new CdsAuthError(`Unsupported token algorithm ${String(header.alg)}.`);
  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  const source = Object.prototype.hasOwnProperty.call(trusted, iss) ? trusted[iss] : undefined;
  if (!source) throw new CdsAuthError('The token’s issuer is not trusted here.');
  // The audience is this service's URL; tolerate a trailing slash.
  const auds = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).map((a) => String(a).replace(/\/+$/, ''));
  if (!audiences.some((a) => auds.includes(a.replace(/\/+$/, '')))) throw new CdsAuthError('The token was issued for a different service.');
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp);
  const iat = Number(claims.iat ?? exp - MAX_LIFETIME_S);
  if (!Number.isFinite(exp) || exp < now - SKEW_S) throw new CdsAuthError('The token has expired.');
  if (exp - iat > MAX_LIFETIME_S + SKEW_S || iat > now + SKEW_S) throw new CdsAuthError('The token lifetime is not acceptable.');
  const jti = typeof claims.jti === 'string' ? claims.jti.slice(0, 200) : '';
  if (!jti) throw new CdsAuthError('The token has no jti.');
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const pick = (jwks: Jwks) => jwks.keys.filter((k) => (kid ? k.kid === kid : true) && (alg.ec ? k.kty === 'EC' : k.kty === 'RSA'));
  let candidates = pick(await keysFor(iss, source));
  if (!candidates.length) candidates = pick(await keysFor(iss, source, true));
  if (!candidates.length) throw new CdsAuthError('No matching key for the token.');
  const data = Buffer.from(`${h}.${p}`);
  const signature = Buffer.from(sig, 'base64url');
  const ok = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      return verify(alg.hash, data, alg.ec ? { key, dsaEncoding: 'ieee-p1363' } : key, signature);
    } catch {
      return false;
    }
  });
  if (!ok) throw new CdsAuthError('The token signature does not verify.');
  // One use per token: a replayed call is refused (per server instance; tokens live five minutes at most).
  const key = `${iss}#${jti}`;
  for (const [k, until] of seen) if (until < now) seen.delete(k);
  if (seen.has(key)) throw new CdsAuthError('The token was already used.');
  seen.set(key, exp + SKEW_S);
  return iss;
}
