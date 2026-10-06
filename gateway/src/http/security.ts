import http from 'node:http';
import type { AppConfig } from '../config.ts';
import { HttpError } from '../errors.ts';
import { hashSecret, Store, timingSafeHexEqual, type Session } from '../store.ts';

export function sessionFrom(req: http.IncomingMessage, store: Store): Session | null {
  const token = readCookie(req.headers.cookie, 'remote_session');
  if (!token) return null;
  const hash = hashSecret(token);
  return (
    store.data.sessions.find(
      (session) =>
        timingSafeHexEqual(session.tokenHash, hash) && Date.parse(session.expiresAt) > Date.now(),
    ) ?? null
  );
}

export function originAllowed(req: http.IncomingMessage, config: AppConfig): boolean {
  const origin = req.headers.origin;
  if (!origin || Array.isArray(origin)) return !origin;
  if (config.publicOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function cookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [
    `remote_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0)
      return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function limit(
  buckets: Map<string, number[]>,
  key: string,
  max: number,
  windowMs: number,
): void {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= max)
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a moment and try again.');
  recent.push(now);
  buckets.set(key, recent);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
