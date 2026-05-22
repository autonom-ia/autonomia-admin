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

  app.setErrorHandler((error, _request, reply) => {
    const apiError = error as { statusCode?: number; message?: string };
    const statusCode = apiError.statusCode && apiError.statusCode >= 400 ? apiError.statusCode : 500;
    const message = statusCode >= 500 ? "Internal server error." : apiError.message ?? "Invalid request.";
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST",
        message
      }
    });
  });

  return app;
}
