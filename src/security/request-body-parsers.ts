import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';

const DEFAULT_BODY_LIMIT = '1mb';
const CONTACT_MESSAGE_BODY_LIMIT = '5mb';
const SEPAY_WEBHOOK_BODY_LIMIT = '64kb';
const SEPAY_WEBHOOK_PATH = '/payments/webhooks/sepay';

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

function isContactMessagePath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === '/contact/messages';
}

function isSePayWebhookPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === SEPAY_WEBHOOK_PATH;
}

/** Keep the larger JSON allowance limited to the public contact image endpoint. */
export function createRequestBodyParsers() {
  const defaultJsonParser = json({ limit: DEFAULT_BODY_LIMIT });
  const contactJsonParser = json({ limit: CONTACT_MESSAGE_BODY_LIMIT });
  const sePayJsonParser = json({
    limit: SEPAY_WEBHOOK_BODY_LIMIT,
    verify: (request, _response, buffer) => {
      (request as RequestWithRawBody).rawBody = Buffer.from(buffer);
    },
  });
  const defaultUrlencodedParser = urlencoded({
    extended: true,
    limit: DEFAULT_BODY_LIMIT,
  });
  const contactUrlencodedParser = urlencoded({
    extended: true,
    limit: CONTACT_MESSAGE_BODY_LIMIT,
  });

  const selectParser =
    (
      defaultParser: typeof defaultJsonParser,
      contactParser: typeof contactJsonParser,
      sePayParser?: typeof defaultJsonParser,
    ) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const parser = isContactMessagePath(req.path)
        ? contactParser
        : sePayParser && isSePayWebhookPath(req.path)
          ? sePayParser
          : defaultParser;
      parser(req, res, next);
    };

  return {
    json: selectParser(defaultJsonParser, contactJsonParser, sePayJsonParser),
    urlencoded: selectParser(defaultUrlencodedParser, contactUrlencodedParser),
  };
}
