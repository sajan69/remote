export function redact(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._\-+/=]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .slice(0, 240);
}
