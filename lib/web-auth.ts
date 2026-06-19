import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';

export const ADMIN_EMAIL = 'the.real.ferilee@gmail.com';
const SESSION_COOKIE_NAME = 'cybra_web_session';
const STATE_COOKIE_NAME = 'cybra_google_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_TTL_SECONDS = 60 * 10;

export type WebRole = 'admin' | 'visitor';

export type WebSession = {
  email: string;
  name: string;
  picture?: string | null;
  role: WebRole;
};

type WebSessionPayload = WebSession & {
  issuedAt: number;
  expiresAt: number;
};

type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function getSessionSecret() {
  return process.env.SESSION_SECRET?.trim() || process.env.ADMIN_TOKEN?.trim() || 'cybra-dev-session-secret';
}

function getConfiguredPublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || '';
}

function toBase64Url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

async function signValue(value: string) {
  const secret = getSessionSecret();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Buffer.from(signature).toString('base64url');
}

async function verifySignedValue(value: string, signature: string) {
  const expected = await signValue(value);
  if (signature.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getCookieOptions(c: Context) {
  const configuredBaseUrl = getConfiguredPublicBaseUrl();
  const protocol = configuredBaseUrl
    ? new URL(configuredBaseUrl).protocol
    : new URL(c.req.url).protocol;

  return {
    httpOnly: true,
    secure: protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/',
  };
}

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function resolveWebRole(email: string): WebRole {
  return email.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'visitor';
}

export async function createSessionCookieValue(session: WebSession) {
  const now = Math.floor(Date.now() / 1000);
  const payload: WebSessionPayload = {
    ...session,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = await signValue(encoded);
  return `${encoded}.${signature}`;
}

export async function parseSessionCookieValue(rawValue: string | undefined | null) {
  if (!rawValue) {
    return null;
  }

  const [encoded, signature] = rawValue.split('.');
  if (!encoded || !signature) {
    return null;
  }

  if (!(await verifySignedValue(encoded, signature))) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as Partial<WebSessionPayload>;
    if (
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string' ||
      (payload.role !== 'admin' && payload.role !== 'visitor') ||
      typeof payload.expiresAt !== 'number'
    ) {
      return null;
    }

    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      email: payload.email,
      name: payload.name,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      role: payload.role,
    } satisfies WebSession;
  } catch {
    return null;
  }
}

export async function getWebSession(c: Context) {
  return parseSessionCookieValue(getCookie(c, SESSION_COOKIE_NAME));
}

export async function persistWebSession(c: Context, session: WebSession) {
  setCookie(c, SESSION_COOKIE_NAME, await createSessionCookieValue(session), {
    ...getCookieOptions(c),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearWebSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
  });
}

export function createGoogleAuthUrl(c: Context, nextPath = '/chat') {
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE_NAME, JSON.stringify({
    state,
    nextPath: nextPath.startsWith('/') ? nextPath : '/chat',
    issuedAt: Date.now(),
  }), {
    ...getCookieOptions(c),
    maxAge: STATE_TTL_SECONDS,
  });

  const redirectUri = getGoogleRedirectUri(c);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  return url.toString();
}

export function consumeOAuthState(c: Context, state: string | null | undefined) {
  const raw = getCookie(c, STATE_COOKIE_NAME);
  deleteCookie(c, STATE_COOKIE_NAME, { path: '/' });

  if (!raw || !state) {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as { state?: string; nextPath?: string; issuedAt?: number };
    if (payload.state !== state) {
      return null;
    }
    if (typeof payload.issuedAt !== 'number' || Date.now() - payload.issuedAt > STATE_TTL_SECONDS * 1000) {
      return null;
    }
    return payload.nextPath && payload.nextPath.startsWith('/') ? payload.nextPath : '/chat';
  } catch {
    return null;
  }
}

export function getGoogleRedirectUri(c: Context) {
  const configuredBaseUrl = getConfiguredPublicBaseUrl();
  if (configuredBaseUrl) {
    return new URL('/auth/google/callback', configuredBaseUrl).toString();
  }

  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}/auth/google/callback`;
  }

  return new URL('/auth/google/callback', c.req.url).toString();
}

export async function exchangeGoogleCode(c: Context, code: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: getGoogleRedirectUri(c),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error('Google token exchange failed.');
  }

  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Google access token missing.');
  }

  return payload.access_token;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Google user info request failed.');
  }

  const payload = await response.json() as GoogleUserInfo;
  if (!payload.email || !payload.email_verified) {
    throw new Error('Google account email is unavailable or unverified.');
  }

  return payload;
}

export async function createWebSessionFromGoogle(c: Context, code: string) {
  const accessToken = await exchangeGoogleCode(c, code);
  const userInfo = await fetchGoogleUserInfo(accessToken);
  const session: WebSession = {
    email: userInfo.email!,
    name: userInfo.name?.trim() || userInfo.email!,
    picture: userInfo.picture || null,
    role: resolveWebRole(userInfo.email!),
  };
  await persistWebSession(c, session);
  return session;
}
