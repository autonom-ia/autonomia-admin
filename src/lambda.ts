import awsLambdaFastify from "@fastify/aws-lambda";
import type { APIGatewayProxyEventV2, Callback, Context } from "aws-lambda";
import { buildServer } from "./server.js";

let proxyPromise: Promise<ReturnType<typeof awsLambdaFastify>> | undefined;

async function getProxy() {
  proxyPromise ??= buildServer().then((app) =>
    awsLambdaFastify(app, {
      decorateRequest: false
    })
  );
  return proxyPromise;
}

export async function handler(event: APIGatewayProxyEventV2, context: Context, callback: Callback) {
  const proxy = await getProxy();
  return proxy(event, context, callback);
}
