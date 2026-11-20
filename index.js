// Enzonic Panel's “Main File” is index.js. Our real Node server is TypeScript.
// Register the tsx loader first and then start exactly the same server as npm start.
import { register } from 'tsx/esm/api';
register();
const { bootstrap } = await import('./server.ts');
await bootstrap();
