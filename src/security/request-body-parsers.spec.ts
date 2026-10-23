import express from 'express';
import request from 'supertest';
import { createRequestBodyParsers } from './request-body-parsers';

describe('request body parser limits', () => {
  const app = express();
  const parsers = createRequestBodyParsers();

  app.use(parsers.json);
  app.use(parsers.urlencoded);
  app.post('/contact/messages', (_req, res) => res.sendStatus(200));
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
});
