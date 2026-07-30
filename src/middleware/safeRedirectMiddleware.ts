import type { Request, Response, NextFunction } from 'express';
import { isSafeRedirectTarget } from '../lib/security/safeRedirect.js';

const ALLOWED_ORIGINS = [
  'https://stellarlend.com',
  'https://stellarlend.com',
  'http://localhost:3000'
];

export function safeRedirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalRedirect = res.redirect.bind(res);

  // Tipamos la función usando la firma nativa de Express para evitar usar "any"
  res.redirect = function (first: number | string, second?: string): void {
    let targetUrl: string;
    let statusCode: number | undefined;

    if (typeof first === 'number') {
      statusCode = first;
      targetUrl = second || '/';
    } else {
      targetUrl = first;
    }

    if (isSafeRedirectTarget(targetUrl, ALLOWED_ORIGINS)) {
      if (statusCode !== undefined) {
        originalRedirect(statusCode, targetUrl);
      } else {
        originalRedirect(targetUrl);
      }
      return;
    }

    console.warn(`[SECURITY WARNING] Intento de Open-Redirect bloqueado hacia: ${targetUrl}`);
    
    if (statusCode !== undefined) {
      originalRedirect(statusCode, '/');
    } else {
      originalRedirect('/');
    }
  } as Response['redirect']; 

  next();
}

