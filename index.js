// Enzonic Panel's “Main File” is index.js. Our real Node server is TypeScript.
// Register the tsx loader first and then start exactly the same server as npm start.
// Hosting panels usually do not set NODE_ENV. Avoid launching Vite dev mode.
process.env.NODE_ENV ||= 'production';
import { register } from 'tsx/esm/api';
register();
const { bootstrap } = await import('./server.ts');
await bootstrap();
