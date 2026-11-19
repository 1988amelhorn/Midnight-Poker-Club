import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../server/supabaseAdmin.ts', () => ({
  supabaseAuthVerifier: { rpc },
}));

import checkUsername from '../api/auth/check-username.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

function invoke(method: string, url: string) {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
  const request = { method, url, headers: { host: 'example.test' } };
  return checkUsername(
    request as unknown as IncomingMessage,
    response as unknown as ServerResponse
  ).then(() => ({ ...response, json: JSON.parse(response.body || '{}') }));
}

describe('Vercel username availability route', () => {
  beforeEach(() => rpc.mockReset());

  it('checks a valid username against the profiles availability RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await invoke('GET', '/api/auth/check-username?username=shark');

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ available: true, valid: true });
    expect(rpc).toHaveBeenCalledWith('check_username_available', {
      p_username: 'shark',
      p_exclude_user_id: null,
    });
  });

  it('rejects invalid usernames without querying Supabase', async () => {
    const response = await invoke('GET', '/api/auth/check-username?username=not%20valid');

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ available: false, valid: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a safe service error if the availability RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('database details') });

    const response = await invoke('GET', '/api/auth/check-username?username=shark');

    expect(response.statusCode).toBe(503);
    expect(response.json.error).toBe('Username availability is temporarily unavailable');
    expect(response.body).not.toContain('database details');
  });

  it('only accepts GET requests', async () => {
    const response = await invoke('POST', '/api/auth/check-username?username=shark');

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
    expect(rpc).not.toHaveBeenCalled();
  });
});
