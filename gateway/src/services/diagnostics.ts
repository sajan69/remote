import crypto from 'node:crypto';
import { redact } from '../redact.ts';
import type { Store } from '../store.ts';

export function recordDiagnostic(
  store: Store,
  code: string,
  message: string,
  deviceId?: string,
): void {
  store.mutate((data) => {
    data.diagnostics.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      code,
      message: redact(message),
      ...(deviceId ? { deviceId } : {}),
    });
    if (data.diagnostics.length > 200) data.diagnostics.splice(0, data.diagnostics.length - 200);
  });
}
