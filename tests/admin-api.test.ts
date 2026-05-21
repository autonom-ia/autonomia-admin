import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const token = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: "user-1",
    email: "comercial@autonomia.solutions",
    name: "Comercial Autonomia"
  })).toString("base64url"),
  ""
].join(".");

const accessTokenWithoutProfile = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: "347894e8-80e1-7097-b41c-4798696f6231",
    username: "347894e8-80e1-7097-b41c-4798696f6231",
    token_use: "access"
  })).toString("base64url"),
  ""
].join(".");

const idTokenWithProfile = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: "347894e8-80e1-7097-b41c-4798696f6231",
    email: "comercial@autonomia.solutions",
    name: "Comercial Autonomia",
    token_use: "id"
  })).toString("base64url"),
  ""
].join(".");

describe("admin api", () => {
  it("includes the authenticated principal in /admin/users", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "comercial@autonomia.solutions",
          name: "Comercial Autonomia"
        })
      ])
    );
  });

  it("prefers identity token claims for user profile fields", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: {
        authorization: `Bearer ${accessTokenWithoutProfile}`,
        "x-identity-token": idTokenWithProfile
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      email: "comercial@autonomia.solutions",
      name: "Comercial Autonomia"
    });
  });
});
