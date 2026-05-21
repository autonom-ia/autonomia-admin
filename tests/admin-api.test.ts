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

  it("updates profile, users and roles", async () => {
    const app = await buildServer();
    const headers = { authorization: `Bearer ${token}` };

    const profile = await app.inject({
      method: "PATCH",
      url: "/admin/me",
      headers,
      payload: { name: "Comercial Atualizado", photoUrl: "data:image/png;base64,abc" }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ name: "Comercial Atualizado", photoUrl: "data:image/png;base64,abc" });

    const user = await app.inject({
      method: "POST",
      url: "/admin/users/invitations",
      headers,
      payload: { name: "Novo Usuario", email: "novo@autonomia.solutions", roleNames: ["Comercial"] }
    });
    expect(user.statusCode).toBe(201);
    expect(user.json()).toMatchObject({ email: "novo@autonomia.solutions", status: "invited" });

    const role = await app.inject({
      method: "POST",
      url: "/admin/roles",
      headers,
      payload: { name: "Operador", permissions: ["admin.products.read"] }
    });
    expect(role.statusCode).toBe(201);
    expect(role.json()).toMatchObject({ name: "Operador", permissions: ["admin.products.read"] });
  });
});
