// Vercel Function entrypoint: the existing Express API and WebSocket server
// are exported together so requests can be handled on the Hobby plan.
// Game state is in-memory until a durable shared-state adapter is implemented;
// this entrypoint is intended for functional testing, not scale-out guarantees.
import { createNeonPokerServer } from '../server.ts';

const { httpServer } = createNeonPokerServer();

export default httpServer;
