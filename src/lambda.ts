import awsLambdaFastify from "@fastify/aws-lambda";
import { buildServer } from "./server.js";

const app = await buildServer();

export const handler = awsLambdaFastify(app, {
  decorateRequest: false
});
