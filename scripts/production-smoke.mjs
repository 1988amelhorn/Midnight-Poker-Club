import WebSocket from 'ws';

const base = (process.env.SMOKE_URL || 'https://midnight-poker-club.vercel.app').replace(/\/$/, '');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const request = async (path, method = 'GET', token, payload) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
};

async function run() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.body.status === 'ok',
    'Live backend /api/health failed: ' + JSON.stringify(health));
  console.log('PASS: live backend health');

  // We only use disposable, unique test accounts, with cleanup below.
  const suffix = Date.now().toString(36);
  const creds = ['SmokA' + suffix, 'SmokB' + suffix];
  const players = [];
  try {
    for (let i = 0; i < 2; i++) {
      const register = await request('/api/auth/register', 'POST', undefined, {
        email: 'mpc-smoke-' + i + '-' + suffix + '@example.invalid',
        password: 'smoke_' + suffix + '_test_password',
        username: creds[i],
      });
      assert(register.status === 201 && register.body.token,
        'Test registration failed: ' + JSON.stringify(register));
      players.push(register.body.token);
    }
    console.log('PASS: two player accounts registered');

    const created = await request('/api/rooms', 'POST', players[0], {
      name: 'Multiplayer Smoke ' + suffix,
      gameType: 'holdem',
      visibility: 'public',
      maxPlayers: 2,
      minBuyin: 500,
      maxBuyin: 2000,
      buyinAmount: 500,
    });
    assert(created.status === 201 && created.body.room?.id,
      'Room create failed: ' + JSON.stringify(created));
    const roomId = created.body.room.id;

    const joined = await request('/api/rooms/join', 'POST', players[1], {
      roomIdOrCode: roomId,
      buyinAmount: 500,
    });
    assert(joined.status === 200 && joined.body.room,
      'Second player could not join: ' + JSON.stringify(joined));

    const snap = await request('/api/rooms/' + roomId, 'GET', players[0]);
    assert(snap.status === 200 && snap.body.poker?.seats?.length >= 2,
      'Shared poker room not available: ' + JSON.stringify(snap));
    console.log('PASS: both players share a poker room');

    const started = await request('/api/rooms/' + roomId + '/start', 'POST', players[0]);
    assert(started.status === 200 && started.body.ok === true,
      'Starting live poker hand failed: ' + JSON.stringify(started));
    const liveHand = await request('/api/rooms/' + roomId, 'GET', players[0]);
    assert(liveHand.status === 200 && liveHand.body.poker?.currentTurnUserId,
      'Live hand not dealing/actionable: ' + JSON.stringify(liveHand));
    console.log('PASS: live poker hand started and actionable');


    // Match VITE_WS_URL: Vercel proxies HTTP, while WSS goes directly to Node.
    const wsAddress = new URL(process.env.SMOKE_WS_URL || base.replace(/^http/, 'ws') + '/ws');
    wsAddress.searchParams.set('token', players[0]);
    const message = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsAddress, { handshakeTimeout: 15000, origin: new URL(base).origin });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket timeout')); }, 18000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'ping' })));
      ws.on('message', raw => {
        const payload = JSON.parse(raw.toString());
        if (payload.type === 'pong') {
          clearTimeout(timer);
          ws.close();
          resolve(payload);
        }
      });
      ws.on('error', err => { clearTimeout(timer); reject(err); });
      ws.on('close', code => {
        if (code !== 1000 && code !== 1005) {
          clearTimeout(timer);
          reject(new Error('WebSocket closed: ' + code));
        }
      });
    });
    assert(message.type === 'pong', 'WebSocket ping failed');
    console.log('PASS: authenticated live WebSocket ping');

    // Exercise Blackjack through the deployed API, not only the engine tests.
    await request('/api/rooms/' + roomId + '/leave', 'POST', players[1]);
    await request('/api/rooms/' + roomId + '/leave', 'POST', players[0]);
    const bj = await request('/api/rooms', 'POST', players[0], {
      name: 'Blackjack Smoke ' + suffix,
      gameType: 'blackjack',
      visibility: 'private',
      maxPlayers: 1,
      minBuyin: 500,
      maxBuyin: 2000,
      buyinAmount: 500,
    });
    assert(bj.status === 201 && bj.body.room?.id,
      'Blackjack table create failed: ' + JSON.stringify(bj));
    const bjRoomId = bj.body.room.id;
    const bjStart = await request('/api/rooms/' + bjRoomId + '/start', 'POST', players[0]);
    assert(bjStart.status === 200 && bjStart.body.ok,
      'Blackjack round failed to start: ' + JSON.stringify(bjStart));
    const bet = await request('/api/rooms/' + bjRoomId + '/blackjack/action', 'POST', players[0], {
      action: 'place_bet', amount: 100, actionId: 'smoke-bj-' + suffix,
    });
    assert(bet.status === 200 && bet.body.ok,
      'Blackjack bet failed: ' + JSON.stringify(bet));
    console.log('PASS: live blackjack room, round and bet');

    await request('/api/rooms/' + bjRoomId + '/leave', 'POST', players[0]);
    const withBot = await request('/api/rooms', 'POST', players[0], {
      name: 'Bot Smoke ' + suffix,
      gameType: 'holdem', visibility: 'private', maxPlayers: 2,
      minBuyin: 500, maxBuyin: 2000, buyinAmount: 500,
      initialBots: 1, botDifficulty: 'normal',
    });
    assert(withBot.status === 201 && withBot.body.room?.id,
      'Bot room creation failed: ' + JSON.stringify(withBot));
    const botRoomId = withBot.body.room.id;
    const botStart = await request('/api/rooms/' + botRoomId + '/start', 'POST', players[0]);
    assert(botStart.status === 200 && botStart.body.ok,
      'Poker game with bot failed to start: ' + JSON.stringify(botStart));
    console.log('PASS: live poker game against bot');
    await request('/api/rooms/' + botRoomId + '/leave', 'POST', players[0]);
  } finally {
    for (const token of players) {
      try { await request('/api/account', 'DELETE', token); } catch {}
    }
  }
}

run().catch(error => { console.error('FAIL:', error); process.exitCode = 1; });
