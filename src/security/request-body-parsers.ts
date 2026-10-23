import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';

const DEFAULT_BODY_LIMIT = '1mb';
const CONTACT_MESSAGE_BODY_LIMIT = '5mb';

function isContactMessagePath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === '/contact/messages';
}

/** Keep the larger JSON allowance limited to the public contact image endpoint. */
export function createRequestBodyParsers() {
  const defaultJsonParser = json({ limit: DEFAULT_BODY_LIMIT });
  const contactJsonParser = json({ limit: CONTACT_MESSAGE_BODY_LIMIT });
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
    ) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const parser = isContactMessagePath(req.path)
        ? contactParser
        : defaultParser;
      parser(req, res, next);
    };

  return {
    json: selectParser(defaultJsonParser, contactJsonParser),
    urlencoded: selectParser(defaultUrlencodedParser, contactUrlencodedParser),
  };
}
