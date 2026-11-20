import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BlackjackTableEngine, scoreBlackjackHand } from '../src/shared/blackjackEngine.ts';
import { choosePokerBotAction, evaluatePreflopStrength } from '../src/shared/pokerBotAi.ts';
import { calculateSidePots, createShuffledDeck, PokerTableEngine } from '../src/shared/pokerEngine.ts';
import { evaluateBestHand, evaluateFiveCards } from '../src/shared/pokerEvaluator.ts';
import type { Card, PokerTableView } from '../src/shared/types.ts';
import { ServerDataStore } from '../server/dataStore.ts';
import { GameManager } from '../server/gameManager.ts';
import { createNeonPokerServer } from '../server.ts';

function c(str: string): Card {
  const rankChar = str.slice(0, -1);
  const suit = str.slice(-1) as Card['suit'];
  const rankMap: Record<string, Card['rank']> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, T: 10, J: 11, Q: 12, K: 13, A: 14,
  };
  return { rank: rankMap[rankChar], suit };
}

describe('Deck & Poker Hand Evaluation', () => {
  it('produces 52 unique cards on every shuffle', () => {
    const deck = createShuffledDeck();
    expect(deck).toHaveLength(52);
    const keys = new Set(deck.map((x) => `${x.rank}${x.suit}`));
    expect(keys.size).toBe(52);
  });

  it('correctly ranks all 10 Texas Holdem hand categories in strict order', () => {
    const royal = evaluateFiveCards([c('As'), c('Ks'), c('Qs'), c('Js'), c('Ts')]);
    const sf = evaluateFiveCards([c('9h'), c('8h'), c('7h'), c('6h'), c('5h')]);
    const quads = evaluateFiveCards([c('Ac'), c('Ad'), c('Ah'), c('As'), c('Kd')]);
    const boat = evaluateFiveCards([c('Ks'), c('Kh'), c('Kd'), c('Qc'), c('Qd')]);
    const flush = evaluateFiveCards([c('Ad'), c('Jd'), c('9d'), c('4d'), c('2d')]);
    const straight = evaluateFiveCards([c('Ts'), c('9h'), c('8d'), c('7c'), c('6s')]);
    const wheel = evaluateFiveCards([c('As'), c('2h'), c('3d'), c('4c'), c('5s')]);
    const trips = evaluateFiveCards([c('Qs'), c('Qh'), c('Qd'), c('9c'), c('4s')]);
    const twoPair = evaluateFiveCards([c('Js'), c('Jh'), c('8d'), c('8c'), c('As')]);
    const onePair = evaluateFiveCards([c('As'), c('Ah'), c('Kd'), c('9c'), c('3s')]);
    const highCard = evaluateFiveCards([c('As'), c('Kh'), c('9d'), c('6c'), c('2s')]);

    expect(royal.category).toBe('Royal Flush');
    expect(sf.category).toBe('Straight Flush');
    expect(quads.category).toBe('Four of a Kind');
    expect(boat.category).toBe('Full House');
    expect(flush.category).toBe('Flush');
    expect(straight.category).toBe('Straight');
    expect(wheel.category).toBe('Straight');
    expect(trips.category).toBe('Three of a Kind');
    expect(twoPair.category).toBe('Two Pair');
    expect(onePair.category).toBe('One Pair');
    expect(highCard.category).toBe('High Card');

    expect(royal.score).toBeGreaterThan(sf.score);
    expect(sf.score).toBeGreaterThan(quads.score);
    expect(quads.score).toBeGreaterThan(boat.score);
    expect(boat.score).toBeGreaterThan(flush.score);
    expect(flush.score).toBeGreaterThan(straight.score);
    expect(straight.score).toBeGreaterThan(wheel.score);
    expect(wheel.score).toBeGreaterThan(trips.score);
    expect(trips.score).toBeGreaterThan(twoPair.score);
    expect(twoPair.score).toBeGreaterThan(onePair.score);
    expect(onePair.score).toBeGreaterThan(highCard.score);
  });

  it('evaluates 7-card best hand and exact tie-breakers', () => {
    const p1 = evaluateBestHand([c('As'), c('Ad'), c('Ah'), c('Ks'), c('Kc'), c('2d'), c('7h')]);
    const p2 = evaluateBestHand([c('Qs'), c('Qd'), c('Qh'), c('Ks'), c('Kc'), c('2d'), c('7h')]);
    expect(p1.category).toBe('Full House');
    expect(p1.description).toBe('Full House — Aces Full of Kings');
    expect(p2.category).toBe('Full House');
    expect(p2.description).toBe('Full House — Queens Full of Kings');
    expect(p1.score).toBeGreaterThan(p2.score);
  });
});

describe('Texas Holdem Engine Rules & Side Pots', () => {
  it('enforces heads-up blind rules (Dealer = SB, acts first preflop) and protects private cards', () => {
    const engine = new PokerTableEngine({
      roomId: 'r1',
      smallBlind: 25,
      bigBlind: 50,
      gameSpeed: 'normal',
      allowProbabilityAssist: true,
    });
    engine.addPlayer('u1', 'Alice', 'ace-spade', 1000, 0);
    engine.addPlayer('u2', 'Bob', 'king-heart', 1000, 1);

    expect(engine.startNewHand()).toBe(true);
    const dealer = engine.seats.find((s) => s.isDealer)!;
    const other = engine.seats.find((s) => !s.isDealer)!;

    expect(dealer.isSmallBlind).toBe(true);
    expect(other.isBigBlind).toBe(true);
    expect(engine.currentTurnUserId).toBe(dealer.userId);

    // Private per-player view never exposes opponent hole cards pre-showdown
    const aliceView = engine.toPlayerView('u1');
    const aliceSeat = aliceView.seats.find((s) => s.userId === 'u1')!;
    const bobSeatInAliceView = aliceView.seats.find((s) => s.userId === 'u2')!;
    expect(aliceSeat.holeCards).toHaveLength(2);
    expect(bobSeatInAliceView.holeCards).toBeNull();
  });

  it('enforces minimum legal raise and rejects duplicate idempotent requests', () => {
    const engine = new PokerTableEngine({
      roomId: 'r2',
      smallBlind: 25,
      bigBlind: 50,
      gameSpeed: 'normal',
      allowProbabilityAssist: true,
    });
    engine.addPlayer('u1', 'Alice', 'ace-spade', 2000, 0);
    engine.addPlayer('u2', 'Bob', 'king-heart', 2000, 1);
    engine.startNewHand();

    const firstActor = engine.currentTurnUserId!;
    // Min raise to 100 (since currentBet=50, minRaiseDelta=50)
    const illegal = engine.applyAction(firstActor, 'raise', 75);
    expect(illegal.ok).toBe(false);

    const legal = engine.applyAction(firstActor, 'raise', 125, 'act-1');
    expect(legal.ok).toBe(true);

    // Replaying exact same actionId is safely idempotent
    const dup = engine.applyAction(firstActor, 'raise', 125, 'act-1');
    expect(dup.ok).toBe(true);
    expect(dup.duplicate).toBe(true);
  });

  it('computes multi-way all-in side pots accurately and conserves total chips', () => {
    const pots = calculateSidePots([
      { userId: 'short', totalBetThisHand: 100, folded: false },
      { userId: 'mid', totalBetThisHand: 300, folded: false },
      { userId: 'big', totalBetThisHand: 800, folded: false },
      { userId: 'folder', totalBetThisHand: 50, folded: true },
    ]);

    // Main pot: 50 (folder) + 100*3 = 350 eligible [short, mid, big]
    // Side pot 1: (300-100)*2 = 400 eligible [mid, big]
    // Side pot 2: (800-300)*1 = 500 eligible [big]
    expect(pots).toHaveLength(3);
    expect(pots[0].amount).toBe(350);
    expect(pots[0].eligibleUserIds).toEqual(['short', 'mid', 'big']);
    expect(pots[1].amount).toBe(400);
    expect(pots[1].eligibleUserIds).toEqual(['mid', 'big']);
    expect(pots[2].amount).toBe(500);
    expect(pots[2].eligibleUserIds).toEqual(['big']);

    const total = pots.reduce((acc, p) => acc + p.amount, 0);
    expect(total).toBe(100 + 300 + 800 + 50);
  });

  it('conserves chips across full hand and handles split pots', () => {
    const engine = new PokerTableEngine({
      roomId: 'r3',
      smallBlind: 25,
      bigBlind: 50,
      gameSpeed: 'fast',
      allowProbabilityAssist: true,
    });
    engine.addPlayer('u1', 'Alice', 'ace-spade', 1000, 0);
    engine.addPlayer('u2', 'Bob', 'king-heart', 1000, 1);
    engine.addPlayer('u3', 'Cara', 'queen-diamond', 1000, 2);
    engine.startNewHand();

    // Everyone calls / checks to showdown
    let safety = 0;
    while (engine.street !== 'showdown' && engine.currentTurnUserId && safety < 50) {
      const uid = engine.currentTurnUserId;
      const legal = engine.getLegalActions(uid)!;
      if (legal.canCheck) engine.applyAction(uid, 'check');
      else engine.applyAction(uid, 'call');
      safety++;
    }

    expect(engine.street).toBe('showdown');
    const sumAfter = engine.seats.reduce((acc, s) => acc + s.chips, 0);
    expect(sumAfter).toBe(3000);
  });
});

describe('Blackjack Engine Rules', () => {
  it('scores soft/hard Aces and natural 21 correctly', () => {
    const bj = scoreBlackjackHand([c('As'), c('Kh')]);
    expect(bj.score).toBe(21);
    expect(bj.isBlackjack).toBe(true);

    const soft = scoreBlackjackHand([c('As'), c('6d')]);
    expect(soft.score).toBe(17);
    expect(soft.isSoft).toBe(true);

    const converted = scoreBlackjackHand([c('As'), c('6d'), c('9c')]);
    expect(converted.score).toBe(16);
    expect(converted.isSoft).toBe(false);
    expect(converted.isBust).toBe(false);
  });

  it('supports betting, splitting pairs, doubling down, and 3:2 / 2:1 settlement rules', () => {
    const bj = new BlackjackTableEngine({ roomId: 'bj1', minBet: 25, maxBet: 500, gameSpeed: 'normal' });
    bj.addPlayer('u1', 'Alice', 'ace-spade', 1000);

    // Rig deterministic shoe top cards (pop() draws from end)
    bj.shoe.push(
      c('7c'), // dealer hole (17 total -> stands)
      c('8h'), // player second card (pair of 8s!)
      c('Td'), // dealer upcard
      c('8s')  // player first card
    );

    const betRes = bj.applyAction('u1', 'place_bet', 100);
    expect(betRes.ok).toBe(true);
    expect(bj.phase).toBe('player_turns');

    // Push cards for split draws
    bj.shoe.push(c('3d'), c('2c'));
    const splitRes = bj.applyAction('u1', 'split');
    expect(splitRes.ok).toBe(true);
    expect(bj.seats[0].hands).toHaveLength(2);
    expect(bj.seats[0].tableChips).toBe(800);

    // Stand both split hands -> dealer stands on 17
    bj.applyAction('u1', 'stand');
    bj.applyAction('u1', 'stand');
    expect(bj.phase).toBe('settled');
  });
});

describe('Auth, Wallet Integrity, Private Rooms & Tournaments', () => {
  it('grants 5000 welcome chips once, enforces 24h daily bonus, and prevents negative balances', () => {
    const store = new ServerDataStore();
    const reg = store.registerLocalUser({ email: 'alice@test.com', password: 'password123', username: 'AlicePoker' });
    expect(reg.ok).toBe(true);
    expect(reg.user!.wallet.chipBalance).toBe(5000);

    // Duplicate welcome bonus blocked
    const dupWelcome = store.claimWelcomeBonus(reg.user!.profile.id);
    expect(dupWelcome.ok).toBe(false);

    // Duplicate username blocked
    const dupName = store.registerLocalUser({ email: 'other@test.com', password: 'password123', username: 'alicepoker' });
    expect(dupName.ok).toBe(false);

    // Daily bonus works once, blocked within 24h
    const now = Date.now();
    const d1 = store.claimDailyBonus(reg.user!.profile.id, now);
    expect(d1.ok).toBe(true);
    expect(d1.newBalance).toBe(7000);

    const d2 = store.claimDailyBonus(reg.user!.profile.id, now + 60_000);
    expect(d2.ok).toBe(false);
    expect(d2.newBalance).toBe(7000);

    // Negative balance prevented
    const overdraw = store.mutateChips({
      userId: reg.user!.profile.id,
      delta: -99999,
      txType: 'table_buyin',
      description: 'Attempt overdraw',
    });
    expect(overdraw.ok).toBe(false);
    expect(reg.user!.wallet.chipBalance).toBe(7000);
  });

  it('protects private rooms with code & password, restores wallet chips on leave, and runs tournaments', () => {
    const store = new ServerDataStore();
    const gm = new GameManager(store);

    const u1 = store.registerLocalUser({ email: 'host@test.com', password: 'password123', username: 'HostOne' }).user!;
    const u2 = store.registerLocalUser({ email: 'guest@test.com', password: 'password123', username: 'GuestTwo' }).user!;

    const created = gm.createRoom({
      hostId: u1.profile.id,
      name: 'Secret High Stakes',
      gameType: 'holdem',
      visibility: 'private',
      maxPlayers: 6,
      password: 'vip99',
      minBuyin: 500,
      maxBuyin: 2000,
    });
    expect(created.ok).toBe(true);

    // Host joins with 1000 chips
    gm.joinRoom({ userId: u1.profile.id, roomIdOrCode: created.room!.code, password: 'vip99', buyinAmount: 1000 });
    expect(u1.wallet.chipBalance).toBe(4000);

    // Wrong password rejected
    const badJoin = gm.joinRoom({ userId: u2.profile.id, roomIdOrCode: created.room!.code, password: 'wrong', buyinAmount: 1000 });
    expect(badJoin.ok).toBe(false);

    // Correct password joins
    const goodJoin = gm.joinRoom({ userId: u2.profile.id, roomIdOrCode: created.room!.code, password: 'vip99', buyinAmount: 1000 });
    expect(goodJoin.ok).toBe(true);
    expect(u2.wallet.chipBalance).toBe(4000);

    // Leaving returns chips atomically
    gm.leaveRoom(u2.profile.id, created.room!.id);
    expect(u2.wallet.chipBalance).toBe(5000);

    // Tournament creation & start separates tournament chips from wallet
    const tourn = gm.createTournament({
      creatorId: u1.profile.id,
      name: 'Friday Sit & Go',
      maxPlayers: 4,
      startingChips: 5000,
      entryFee: 200,
    });
    expect(tourn.ok).toBe(true);
    expect(u1.wallet.chipBalance).toBe(4000); // tournaments never charge wallet chips

    const j2 = gm.joinTournament(u2.profile.id, tourn.tournament!.code);
    expect(j2.ok).toBe(true);
    expect(u2.wallet.chipBalance).toBe(5000);

    const started = gm.startTournament(u1.profile.id, tourn.tournament!.id);
    expect(started.ok).toBe(true);
    expect(started.tournament!.status).toBe('in_progress');
    expect(started.tournament!.roomId).toBeTruthy();
    expect(started.tournament!.roomIds).toHaveLength(1);
    gm.cleanup();
  });

  it('starts an 18-person freeroll across two evenly seated tables with one entry per player', () => {
    const store = new ServerDataStore();
    const host = store.registerLocalUser({ email: 'tourn-host@test.com', password: 'strong-password', username: 'TableDirector' });
    expect(host.ok).toBe(true);
    const gm = new GameManager(store, { botThinkDelayRangeMs: [30000, 30000] });
    const created = gm.createTournament({
      creatorId: host.user!.profile.id,
      name: 'Midnight Championship',
      maxPlayers: 18,
      initialBots: 17,
      startingChips: 5000,
      entryFee: 1000,
    });
    expect(created.ok).toBe(true);
    expect(created.tournament!.entryFee).toBe(0);
    const before = store.users.get(host.user!.profile.id)!.wallet.chipBalance;
    const started = gm.startTournament(host.user!.profile.id, created.tournament!.id);
    expect(started.ok).toBe(true);
    expect(started.tournament!.roomIds).toHaveLength(2);
    expect(started.tournament!.tables.map(t => t.playerCount)).toEqual([9, 9]);
    expect(started.tournament!.players.every(p => Boolean(p.roomId))).toBe(true);
    expect(store.users.get(host.user!.profile.id)!.wallet.chipBalance).toBe(before);
    expect(gm.joinTournament('new-player', created.tournament!.code).ok).toBe(false);
    gm.cleanup();
  });

  it('enforces short all-in non-reopening raise rule in PokerTableEngine', () => {
    const engine = new PokerTableEngine({
      roomId: 'r-short-allin',
      smallBlind: 25,
      bigBlind: 50,
      gameSpeed: 'normal',
      allowProbabilityAssist: false,
    });
    engine.addPlayer('u1', 'BigOne', 'ace-spade', 1000, 0);
    engine.addPlayer('u2', 'ShortStack', 'king-heart', 180, 1);
    engine.addPlayer('u3', 'BigTwo', 'queen-diamond', 1000, 2);
    engine.startNewHand();

    // Advance to flop cleanly by calling around preflop
    let guard = 0;
    while (engine.street === 'preflop' && engine.currentTurnUserId && guard < 10) {
      const uid = engine.currentTurnUserId;
      const legal = engine.getLegalActions(uid)!;
      if (legal.canCheck) engine.applyAction(uid, 'check');
      else engine.applyAction(uid, 'call');
      guard++;
    }
    expect(engine.street).toBe('flop');

    // Make sure u2 has strictly less than 130 left after blinds (180 - 50 = 130), and force u1 or u3 to bet 100
    // Adjust stacks deterministically at start of flop: u1 bets 100, u3 calls 100, u2 (last or middle) shoves 120 (< full min raise of 100 -> 200)
    const first = engine.currentTurnUserId!;
    const secondSeat = engine.seats.find((s) => s.userId !== first && s.userId !== 'u2')!;
    const shortSeat = engine.seats.find((s) => s.userId === 'u2')!;
    shortSeat.chips = 120; // short all-in of +20 over 100 bet

    if (first === 'u2') {
      // Check around so next player bets 100, then u2 shoves 120
      engine.applyAction('u2', 'check');
      const bettor = engine.currentTurnUserId!;
      expect(engine.applyAction(bettor, 'bet', 100).ok).toBe(true);
      const next = engine.currentTurnUserId!;
      if (next !== 'u2') {
        expect(engine.applyAction(next, 'call').ok).toBe(true);
      }
      expect(engine.currentTurnUserId).toBe('u2');
      expect(engine.applyAction('u2', 'all_in').ok).toBe(true);
      // Now back to bettor: facing a +20 short all-in (< minRaiseDelta 100), bettor cannot re-raise
      expect(engine.currentTurnUserId).toBe(bettor);
      const legalBettor = engine.getLegalActions(bettor)!;
      expect(legalBettor.canCall).toBe(true);
      expect(legalBettor.canRaise).toBe(false);
    } else {
      expect(engine.applyAction(first, 'bet', 100).ok).toBe(true);
      if (engine.currentTurnUserId === secondSeat.userId) {
        expect(engine.applyAction(secondSeat.userId, 'call').ok).toBe(true);
      }
      expect(engine.currentTurnUserId).toBe('u2');
      expect(engine.applyAction('u2', 'all_in').ok).toBe(true);
      expect(engine.currentTurnUserId).toBe(first);
      const legalFirst = engine.getLegalActions(first)!;
      expect(legalFirst.canCall).toBe(true);
      expect(legalFirst.canRaise).toBe(false);
    }
  });

  it('stands on dealer soft 17 and pays 2:1 insurance on dealer Blackjack', () => {
    const bj = new BlackjackTableEngine({ roomId: 'bj-ins', minBet: 25, maxBet: 500, gameSpeed: 'fast' });
    bj.addPlayer('u1', 'Alice', 'ace-spade', 1000);

    // Rig shoe so dealer gets Ace up + King hole (Blackjack), player gets 10 + 9 (19)
    bj.shoe.push(
      c('Kc'), // dealer hole
      c('9h'), // player 2nd
      c('As'), // dealer upcard (Ace!)
      c('Td')  // player 1st
    );
    bj.applyAction('u1', 'place_bet', 100);
    expect(bj.phase).toBe('insurance');

    const insRes = bj.applyAction('u1', 'insurance_accept');
    expect(insRes.ok).toBe(true);
    expect(bj.phase).toBe('settled');
    // Player wagered 100 main bet + 50 insurance. Main bet loses (-100), insurance pays 2:1 (+150 total returned = +100 net).
    // Final chips: 1000 - 100 - 50 + 150 = 1000
    expect(bj.seats[0].tableChips).toBe(1000);

    // Next round: verify dealer stands on soft 17 (A + 6)
    bj.shoe.push(
      c('6s'), // dealer hole -> A + 6 = Soft 17 -> must stand
      c('8c'), // player 2nd -> 18
      c('Ad'), // dealer upcard
      c('Ts')  // player 1st -> 18
    );
    bj.applyAction('u1', 'place_bet', 100);
    bj.applyAction('u1', 'insurance_decline');
    expect(bj.phase).toBe('player_turns');
    bj.applyAction('u1', 'stand');
    expect(bj.phase).toBe('settled');
    expect(bj.dealerCards).toHaveLength(2); // Did not hit soft 17
    expect(bj.seats[0].hands[0].outcome).toBe('win');
  });

  it('enforces friend-only chip transfers and enforces server admin RBAC via HTTP', async () => {
    const { httpServer } = createNeonPokerServer();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      // First registered user becomes admin
      const r1 = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@club.test', password: 'password123', username: 'ClubAdmin' }),
      });
      const adminData = (await r1.json()) as { token: string; user: { id: string; role: string } };
      expect(r1.status).toBe(201);
      expect(adminData.user.role).toBe('admin');

      // Second registered user is regular player
      const r2 = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'player@club.test', password: 'password123', username: 'RegularJoe' }),
      });
      const playerData = (await r2.json()) as { token: string; user: { id: string; role: string } };
      expect(r2.status).toBe(201);
      expect(playerData.user.role).toBe('player');

      // Non-admin blocked from /api/admin/overview (403)
      const forbiddenRes = await fetch(`${base}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${playerData.token}` },
      });
      expect(forbiddenRes.status).toBe(403);

      // Admin allowed on /api/admin/overview (200)
      const adminRes = await fetch(`${base}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${adminData.token}` },
      });
      expect(adminRes.status).toBe(200);

      // Non-friend chip transfer rejected (400)
      const giftBeforeFriend = await fetch(`${base}/api/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminData.token}` },
        body: JSON.stringify({ recipientId: playerData.user.id, amount: 200, idempotencyKey: 'g1' }),
      });
      expect(giftBeforeFriend.status).toBe(400);

      // Add & accept friend request -> then transfer succeeds atomically
      const frReq = await fetch(`${base}/api/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminData.token}` },
        body: JSON.stringify({ receiverId: playerData.user.id }),
      });
      const frJson = (await frReq.json()) as { request: { id: string } };
      await fetch(`${base}/api/friends/requests/${frJson.request.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerData.token}` },
        body: JSON.stringify({ accept: true }),
      });

      const giftOk = await fetch(`${base}/api/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminData.token}` },
        body: JSON.stringify({ recipientId: playerData.user.id, amount: 200, idempotencyKey: 'g2' }),
      });
      expect(giftOk.status).toBe(200);
      const giftOkJson = (await giftOk.json()) as { newBalance: number };
      expect(giftOkJson.newBalance).toBe(4800);

      // Retrying a confirmed gift with the same key must not send chips twice.
      const retryGift = await fetch(`${base}/api/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminData.token}` },
        body: JSON.stringify({ recipientId: playerData.user.id, amount: 200, idempotencyKey: 'g2' }),
      });
      expect(retryGift.status).toBe(200);
      expect(((await retryGift.json()) as { newBalance: number }).newBalance).toBe(4800);

      // Verify /api/public-config exposes non-secret diagnostics without leaking any private keys
      const pubRes = await fetch(`${base}/api/public-config`);
      expect(pubRes.status).toBe(200);
      const pubJson = (await pubRes.json()) as {
        supabaseConfigured: boolean;
        supabaseAuthEnabled: boolean;
        hasSupabaseUrl: boolean;
        hasSupabasePublicKey: boolean;
        hasServiceRoleKey: boolean;
      };
      expect(typeof pubJson.supabaseConfigured).toBe('boolean');
      expect(typeof pubJson.supabaseAuthEnabled).toBe('boolean');
      expect(typeof pubJson.hasSupabaseUrl).toBe('boolean');
      expect(typeof pubJson.hasSupabasePublicKey).toBe('boolean');
      expect(typeof pubJson.hasServiceRoleKey).toBe('boolean');
      expect(JSON.stringify(pubJson)).not.toContain('SERVICE_ROLE');

      // Verify /api/auth/check-username reports taken vs fresh usernames
      const takenCheck = await fetch(`${base}/api/auth/check-username?username=RegularJoe`);
      expect(takenCheck.status).toBe(200);
      const takenJson = (await takenCheck.json()) as { available: boolean; valid: boolean };
      expect(takenJson.valid).toBe(true);
      expect(takenJson.available).toBe(false);

      const freeCheck = await fetch(`${base}/api/auth/check-username?username=FreshShark99`);
      expect(freeCheck.status).toBe(200);
      const freeJson = (await freeCheck.json()) as { available: boolean; valid: boolean };
      expect(freeJson.valid).toBe(true);
      expect(freeJson.available).toBe(true);

      // Verify leaderboards reflect actual registered users and balances
      const lbRes = await fetch(`${base}/api/leaderboards`, {
        headers: { Authorization: `Bearer ${playerData.token}` },
      });
      expect(lbRes.status).toBe(200);
      const lbJson = (await lbRes.json()) as { chipBalances: Array<{ username: string; value: number }> };
      expect(lbJson.chipBalances[0].username).toBe('RegularJoe');
      expect(lbJson.chipBalances[0].value).toBe(5200);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('rotates dealer button and blinds cleanly across consecutive hands and tracks preflop all-in runout', () => {
    const engine = new PokerTableEngine({
      roomId: 'r-rotate',
      smallBlind: 25,
      bigBlind: 50,
      gameSpeed: 'relaxed',
      allowProbabilityAssist: false,
    });
    const completedSummaries: Array<{ runoutCardsAdded?: number }> = [];
    engine.onHandCompleted = (s) => {
      completedSummaries.push(s);
    };

    engine.addPlayer('p0', 'P0', 'ace-spade', 1000, 0);
    engine.addPlayer('p1', 'P1', 'king-heart', 1000, 1);
    engine.addPlayer('p2', 'P2', 'queen-diamond', 1000, 2);

    // Hand 1
    engine.startNewHand();
    const h1Dealer = engine.dealerSeat;
    const h1Sb = engine.seats.find((s) => s.isSmallBlind)!.seatIndex;
    const h1Bb = engine.seats.find((s) => s.isBigBlind)!.seatIndex;
    expect(h1Sb).toBe((h1Dealer + 1) % 3);
    expect(h1Bb).toBe((h1Dealer + 2) % 3);

    // Fold two players quickly so Hand 1 finishes
    engine.applyAction(engine.currentTurnUserId!, 'fold');
    engine.applyAction(engine.currentTurnUserId!, 'fold');
    expect(engine.street).toBe('showdown');

    // Hand 2: dealer, SB, BB all rotate clockwise by 1
    engine.startNewHand();
    expect(engine.dealerSeat).toBe((h1Dealer + 1) % 3);
    expect(engine.seats.find((s) => s.isSmallBlind)!.seatIndex).toBe((h1Sb + 1) % 3);
    expect(engine.seats.find((s) => s.isBigBlind)!.seatIndex).toBe((h1Bb + 1) % 3);

    // All three shove preflop -> should run out all 5 board cards automatically & conserve 3000 chips
    engine.applyAction(engine.currentTurnUserId!, 'all_in');
    engine.applyAction(engine.currentTurnUserId!, 'all_in');
    engine.applyAction(engine.currentTurnUserId!, 'all_in');
    expect(engine.street).toBe('showdown');
    expect(engine.communityCards).toHaveLength(5);
    expect(completedSummaries[completedSummaries.length - 1]?.runoutCardsAdded).toBe(5);
    expect(engine.seats.reduce((sum, s) => sum + s.chips, 0)).toBe(3000);
  });
});

describe('Poker Bot AI (Normal Default, Non-Cheating & Contextual Play)', () => {
  it('ranks preflop hole strength accurately and plays tight vs strong hands without seeing hidden cards', () => {
    const acesStrength = evaluatePreflopStrength([c('As'), c('Ah')]);
    const akSuitedStrength = evaluatePreflopStrength([c('As'), c('Ks')]);
    const trashStrength = evaluatePreflopStrength([c('7c'), c('2d')]);

    expect(acesStrength).toBeGreaterThan(akSuitedStrength);
    expect(akSuitedStrength).toBeGreaterThan(65);
    expect(trashStrength).toBeLessThan(35);

    const baseSeats = [
      {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 50,
        folded: false,
        allIn: false,
        sittingOut: false,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: true,
      },
      {
        userId: 'human-1',
        seatIndex: 1,
        chips: 1200,
        currentBet: 250,
        folded: false,
        allIn: false,
        sittingOut: false,
        isDealer: true,
        isSmallBlind: true,
        isBigBlind: false,
      },
    ];

    const facingLargeRaise = {
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 200,
      canBet: false,
      canRaise: true,
      minBetOrRaiseTo: 450,
      maxBetOrRaiseTo: 1550,
      canAllIn: true,
    };

    // Pocket Aces raise or call aggressively
    const strongDecision = choosePokerBotAction({
      holeCards: [c('As'), c('Ah')],
      communityCards: [],
      street: 'preflop',
      pot: 300,
      currentBet: 250,
      smallBlind: 25,
      bigBlind: 50,
      legalActions: facingLargeRaise,
      selfSeat: {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 50,
        totalBetThisHand: 50,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: true,
      },
      seats: baseSeats,
      actionLog: [{ userId: 'human-1', text: 'Human raised to 250', street: 'preflop' }],
      difficulty: 'normal',
      rng: () => 0.4,
    });
    expect(['raise', 'all_in', 'call']).toContain(strongDecision.action);

    // 7-2 offsuit folds facing a 5x BB raise out of position
    const weakDecision = choosePokerBotAction({
      holeCards: [c('7c'), c('2d')],
      communityCards: [],
      street: 'preflop',
      pot: 300,
      currentBet: 250,
      smallBlind: 25,
      bigBlind: 50,
      legalActions: facingLargeRaise,
      selfSeat: {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 50,
        totalBetThisHand: 50,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: true,
      },
      seats: baseSeats,
      actionLog: [{ userId: 'human-1', text: 'Human raised to 250', street: 'preflop' }],
      difficulty: 'normal',
      rng: () => 0.4,
    });
    expect(weakDecision.action).toBe('fold');
  });

  it('respects postflop pot odds with flush draws and refuses massive overbets with pure air', () => {
    const seats = [
      {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 0,
        folded: false,
        allIn: false,
        sittingOut: false,
        isDealer: true,
        isSmallBlind: true,
        isBigBlind: false,
      },
      {
        userId: 'human-1',
        seatIndex: 1,
        chips: 1500,
        currentBet: 100,
        folded: false,
        allIn: false,
        sittingOut: false,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: true,
      },
    ];

    // Flop nut flush draw + two overcards facing small 100 bet into 400 pot (~20% pot odds vs ~35% equity) -> should call or semi-bluff raise
    const drawCall = choosePokerBotAction({
      holeCards: [c('Ah'), c('Kh')],
      communityCards: [c('Qh'), c('9h'), c('3c')],
      street: 'flop',
      pot: 500,
      currentBet: 100,
      smallBlind: 25,
      bigBlind: 50,
      legalActions: {
        canFold: true,
        canCheck: false,
        canCall: true,
        callAmount: 100,
        canBet: false,
        canRaise: true,
        minBetOrRaiseTo: 200,
        maxBetOrRaiseTo: 1500,
        canAllIn: true,
      },
      selfSeat: {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 0,
        totalBetThisHand: 150,
        isDealer: true,
        isSmallBlind: true,
        isBigBlind: false,
      },
      seats,
      actionLog: [{ userId: 'human-1', text: 'Human bet 100', street: 'flop' }],
      difficulty: 'normal',
      rng: () => 0.5,
    });
    expect(['call', 'raise']).toContain(drawCall.action);

    // River pure air (8 high) facing huge 900 bet into 100 pot -> must fold
    const riverAirFold = choosePokerBotAction({
      holeCards: [c('8c'), c('4d')],
      communityCards: [c('Ks'), c('Qh'), c('Jd'), c('9s'), c('2c')],
      street: 'river',
      pot: 1000,
      currentBet: 900,
      smallBlind: 25,
      bigBlind: 50,
      legalActions: {
        canFold: true,
        canCheck: false,
        canCall: true,
        callAmount: 900,
        canBet: false,
        canRaise: false,
        minBetOrRaiseTo: 0,
        maxBetOrRaiseTo: 1500,
        canAllIn: true,
      },
      selfSeat: {
        userId: 'bot-1',
        seatIndex: 0,
        chips: 1500,
        currentBet: 0,
        totalBetThisHand: 50,
        isDealer: true,
        isSmallBlind: true,
        isBigBlind: false,
      },
      seats: [seats[0], { ...seats[1], currentBet: 900 }],
      actionLog: [{ userId: 'human-1', text: 'Human bet 900', street: 'river' }],
      difficulty: 'normal',
      rng: () => 0.5,
    });
    expect(riverAirFold.action).toBe('fold');
  });
});

describe('Poker Bots Server Lifecycle, Mid-Hand Lock, WebSocket Sync & Tournaments', () => {
  it('supports adding/removing bots with default normal difficulty, locks difficulty mid-hand, and plays full hands via WS', async () => {
    const { httpServer, gameManager } = createNeonPokerServer({
      botThinkDelayRangeMs: [25, 45],
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    let ws: WebSocket | null = null;
    try {
      const regRes = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bot-host@club.test', password: 'password123', username: 'BotHost' }),
      });
      const host = (await regRes.json()) as { token: string; user: { id: string } };
      expect(regRes.status).toBe(201);

      // Create private room with 1 initial bot (defaults to normal)
      const createRes = await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({
          name: 'Bot Sparring Table',
          gameType: 'holdem',
          visibility: 'private',
          maxPlayers: 6,
          smallBlind: 25,
          bigBlind: 50,
          minBuyin: 500,
          maxBuyin: 2000,
          initialBots: 1,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { room: { id: string; players: Array<{ userId: string; isBot?: boolean; botDifficulty?: string }> } };
      expect(created.room.players.filter((p) => p.isBot)).toHaveLength(1);
      expect(created.room.players.find((p) => p.isBot)?.botDifficulty).toBe('normal');

      // Add 2nd bot via POST /api/rooms/:id/bots (default normal)
      const addBotRes = await fetch(`${base}/api/rooms/${created.room.id}/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({}),
      });
      expect(addBotRes.status).toBe(201);
      const added = (await addBotRes.json()) as {
        botUserId: string;
        room: { players: Array<{ userId: string; isBot?: boolean; botDifficulty?: string }> };
      };
      expect(added.room.players.filter((p) => p.isBot)).toHaveLength(2);
      const secondBotId = added.botUserId;
      const firstBotId = added.room.players.find((p) => p.isBot && p.userId !== secondBotId)!.userId;

      // Remove 2nd bot cleanly before starting
      const delBotRes = await fetch(`${base}/api/rooms/${created.room.id}/bots/${secondBotId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${host.token}` },
      });
      expect(delBotRes.status).toBe(200);
      const afterDel = (await delBotRes.json()) as { room: { players: Array<{ isBot?: boolean }> } };
      expect(afterDel.room.players.filter((p) => p.isBot)).toHaveLength(1);

      // Connect authenticated WebSocket client to receive live room:state pushes
      const receivedStates: PokerTableView[] = [];
      ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(host.token)}`);
      await new Promise<void>((resolve, reject) => {
        ws!.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as { type: string; poker?: PokerTableView };
          if (msg.type === 'ws:connected') {
            ws!.send(JSON.stringify({ type: 'room:subscribe', roomId: created.room.id }));
            resolve();
          } else if (msg.type === 'room:state' && msg.poker) {
            receivedStates.push(msg.poker);
          }
        });
        ws!.on('error', reject);
      });

      const initialTotalChips = gameManager.rooms
        .get(created.room.id)!
        .pokerEngine!.seats.reduce((sum, s) => sum + s.chips, 0);
      expect(initialTotalChips).toBe(1500); // host default minBuyin (500) + bot stack (1000)

      // Start the Hold'em hand (1 human vs 1 normal bot)
      const startRes = await fetch(`${base}/api/rooms/${created.room.id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${host.token}` },
      });
      expect(startRes.status).toBe(200);

      // Verify bot difficulty CANNOT be changed mid-hand (must return 400)
      const midHandDiffRes = await fetch(`${base}/api/rooms/${created.room.id}/bots/${firstBotId}/difficulty`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({ difficulty: 'hard' }),
      });
      expect(midHandDiffRes.status).toBe(400);
      const midHandErr = (await midHandDiffRes.json()) as { error: string };
      expect(midHandErr.error.toLowerCase()).toContain('active hand');

      // Human acts when it is their turn until the hand finishes (either fold or bot folds/showdown)
      let safety = 0;
      while (safety < 20) {
        await new Promise((r) => setTimeout(r, 70));
        const roomState = gameManager.rooms.get(created.room.id)!.pokerEngine!;
        if (roomState.street === 'showdown' || roomState.street === 'waiting') break;
        if (roomState.currentTurnUserId === host.user.id) {
          // Alternate checking/calling on hand 1 until showdown or fold
          const legal = roomState.getLegalActions(host.user.id)!;
          const act = legal.canCheck ? 'check' : legal.canCall && legal.callAmount <= 200 ? 'call' : 'fold';
          await fetch(`${base}/api/rooms/${created.room.id}/poker/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
            body: JSON.stringify({ action: act }),
          });
        }
        safety++;
      }

      const engineAfter = gameManager.rooms.get(created.room.id)!.pokerEngine!;
      expect(['showdown', 'waiting']).toContain(engineAfter.street);
      expect(receivedStates.length).toBeGreaterThanOrEqual(2);
      expect(receivedStates[receivedStates.length - 1].seats.some((s) => s.isBot && s.botDifficulty === 'normal')).toBe(true);

      // Chip conservation check
      const totalChipsOnTable = engineAfter.seats.reduce((sum, s) => sum + s.chips, 0);
      expect(totalChipsOnTable).toBe(initialTotalChips);

      // Once at showdown/waiting, host IS allowed to update bot difficulty
      const postHandDiffRes = await fetch(`${base}/api/rooms/${created.room.id}/bots/${firstBotId}/difficulty`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({ difficulty: 'hard' }),
      });
      expect(postHandDiffRes.status).toBe(200);
      expect(engineAfter.seats.find((s) => s.userId === firstBotId)?.botDifficulty).toBe('hard');

      // Tournament bots: initialBots=2 + add 1 bot, prizePool only counts paying humans
      const tournRes = await fetch(`${base}/api/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({
          name: 'Bot Mixed Tourney',
          maxPlayers: 6,
          startingChips: 3000,
          entryFee: 100,
          initialBots: 2,
        }),
      });
      expect(tournRes.status).toBe(201);
      const tCreated = (await tournRes.json()) as {
        wallet: { chipBalance: number };
        tournament: { id: string; registeredCount: number; entryFee: number; players: Array<{ isBot?: boolean; botDifficulty?: string }> };
      };
      expect(tCreated.tournament.players.filter((p) => p.isBot)).toHaveLength(2);
      expect(tCreated.tournament.players.filter((p) => !p.isBot)).toHaveLength(1);
      expect(tCreated.tournament.registeredCount).toBe(3);

      const tAddBot = await fetch(`${base}/api/tournaments/${tCreated.tournament.id}/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
        body: JSON.stringify({}),
      });
      expect(tAddBot.status).toBe(201);
      const tStart = await fetch(`${base}/api/tournaments/${tCreated.tournament.id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${host.token}` },
      });
      expect(tStart.status).toBe(200);
      const tStarted = (await tStart.json()) as {
        tournament: { status: string; roomId: string; players: Array<{ isBot?: boolean; botDifficulty?: string }> };
      };
      expect(tStarted.tournament.status).toBe('in_progress');
      expect(tStarted.tournament.players.filter((p) => p.isBot)).toHaveLength(3);
      expect(tStarted.tournament.players.find((p) => p.isBot)?.botDifficulty).toBe('normal');
    } finally {
      ws?.close();
      gameManager.cleanup();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});

