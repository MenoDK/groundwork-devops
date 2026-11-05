import { describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

describe('who may talk to the server', () => {
  it('answers a request addressed to a name it knows', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost:8100' } });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a Host it does not know: that is what a DNS rebinding attack looks like', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example.test' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'host_not_allowed' });
  });

  it('refuses a request that changes something when it comes from another origin', async () => {
    const { app, calls } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/lab/rollback',
      headers: { host: 'localhost:8100', origin: 'https://evil.example.test' },
    });
    expect(res.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses an Origin that is not even a URL, such as the string "null"', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/lab/rollback',
      headers: { host: 'localhost:8100', origin: 'null' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a cross-site fetch even with no Origin header', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/lab/rollback',
      headers: { host: 'localhost:8100', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts the page itself, and a command line with no Origin at all', async () => {
    const { app } = await harness();
    const page = await app.inject({
      method: 'POST',
      url: '/api/lab/rollback',
      headers: { host: 'localhost:8100', origin: 'http://localhost:8100' },
    });
    expect(page.statusCode).toBe(200);
    const curl = await app.inject({ method: 'POST', url: '/api/lab/rollback', headers: { host: 'localhost:8100' } });
    expect(curl.statusCode).toBe(200);
  });

  it('serves the site with a strict policy, and no policy on the API', async () => {
    const { app } = await harness();
    const page = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost' } });
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['content-security-policy']).not.toContain('unsafe-inline');
    const api = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost' } });
    expect(api.headers['content-security-policy']).toBeUndefined();
  });
});
