import http from 'node:http';
import { HttpError } from '../errors.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJson(req: http.IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new HttpError(413, 'payload_too_large', 'That upload is too large.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new HttpError(400, 'invalid_json', 'The request body was not valid JSON.'));
      }
    });
    req.on('error', () =>
      reject(new HttpError(400, 'invalid_json', 'The request body could not be read.')),
    );
  });
}
