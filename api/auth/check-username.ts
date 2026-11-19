import type { IncomingMessage, ServerResponse } from 'node:http';
import { supabaseAuthVerifier } from '../../server/supabaseAdmin.ts';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/;

type VercelRequest = Pick<IncomingMessage, 'method' | 'url' | 'headers'>;
type VercelResponse = Pick<ServerResponse, 'statusCode' | 'setHeader' | 'end'>;

/** Vercel serverless route for the public username-availability check. */
export default async function checkUsername(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const username = (url.searchParams.get('username') || '').trim();
  const valid = USERNAME_PATTERN.test(username);
  if (!valid) {
    res.statusCode = 200;
    res.end(JSON.stringify({ available: false, valid: false }));
    return;
  }

  if (!supabaseAuthVerifier) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'Username availability is temporarily unavailable' }));
    return;
  }

  try {
    // This SECURITY DEFINER RPC checks the existing profiles table without granting
    // the browser access to privileged credentials or profile rows.
    const { data, error } = await supabaseAuthVerifier.rpc('check_username_available', {
      p_username: username,
      p_exclude_user_id: null,
    });
    if (error || typeof data !== 'boolean') {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'Username availability is temporarily unavailable' }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ available: data, valid: true }));
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'Username availability is temporarily unavailable' }));
  }
}
