import express from 'express';
import request from 'supertest';
import {
  createRequestBodyParsers,
  type RequestWithRawBody,
} from './request-body-parsers';

describe('request body parser limits', () => {
  const app = express();
  const parsers = createRequestBodyParsers();

  app.use(parsers.json);
  app.use(parsers.urlencoded);
  app.post('/contact/messages', (_req, res) => res.sendStatus(200));
  app.post('/payments/webhooks/sepay', (req, res) => {
    const webhookRequest = req as RequestWithRawBody;
    res.status(200).json({
      rawBody: webhookRequest.rawBody?.toString('utf8'),
    });
  });
  app.post('/other', (_req, res) => res.sendStatus(200));

  it('allows contact message image payloads up to the contact-specific limit', async () => {
    await request(app)
      .post('/contact/messages')
      .send({ imageData: 'a'.repeat(2 * 1024 * 1024) })
      .expect(200);
  });

  it('rejects the same large payload on unrelated routes', async () => {
    await request(app)
      .post('/other')
      .send({ payload: 'a'.repeat(2 * 1024 * 1024) })
      .expect(413);
  });

  it('keeps the contact limit for a trailing slash', async () => {
    await request(app)
      .post('/contact/messages/')
      .send({ imageData: 'a'.repeat(2 * 1024 * 1024) })
      .expect(200);
  });

  it('captures the exact raw webhook JSON for signature verification', async () => {
    const rawBody = '{ "id": 42, "content": "VINF0123456789ABCDEF" }';

    const response = await request(app)
      .post('/payments/webhooks/sepay')
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(200);

    expect(response.body).toEqual({ rawBody });
  });

  it('limits webhook payloads to 64 KiB', async () => {
    await request(app)
      .post('/payments/webhooks/sepay')
      .send({ content: 'a'.repeat(70 * 1024) })
      .expect(413);
  });
});
