// Temporary legacy compatibility entrypoint: restores the original Vercel
// game routes while dedicated multiplayer hosting is being provisioned.
// IMPORTANT: Vercel's serverless instances do not share process-local tables;
// rooms can vanish between requests, and WebSockets may not connect.
// Revert to statelessRuntime:true if multi-client tests fail.
import { createNeonPokerServer } from '../server.ts';

const { httpServer } = createNeonPokerServer();

export default httpServer;
