import type { NextFunction, Request, Response } from 'express';
import { getCsrfAllowedOrigins, isCsrfOriginAllowed } from './csrf-origin.util';

export function createCsrfOriginMiddleware(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const allowedOrigins = getCsrfAllowedOrigins(environment);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      isCsrfOriginAllowed(
        {
          method: req.method,
          path: req.path,
          origin: req.headers.origin,
          referer: req.headers.referer,
          cookie: req.headers.cookie,
        },
        allowedOrigins,
      )
    ) {
      next();
      return;
    }

    res.status(403).json({
      statusCode: 403,
      message: 'Nguồn yêu cầu không hợp lệ',
    });
  };
}
