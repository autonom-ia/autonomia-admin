import { config } from "./config.js";
import { buildServer } from "./server.js";

const app = await buildServer();
await app.listen({ host: config.host, port: config.port });
