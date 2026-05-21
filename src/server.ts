import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`), false);
    },
    credentials: false
  });

  await registerRoutes(app);
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}
