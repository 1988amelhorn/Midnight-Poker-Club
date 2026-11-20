// Vercel Function entrypoint: the existing Express API and WebSocket server
// are exported together so requests can be handled on the Hobby plan.
// Vercel cannot be authoritative for process-local table state; this function
// serves account endpoints but refuses misleading multiplayer room actions.
// A dedicated Node server handles real poker and blackjack play.
import { createNeonPokerServer } from '../server.ts';

const { httpServer } = createNeonPokerServer({ statelessRuntime: true });

export default httpServer;
