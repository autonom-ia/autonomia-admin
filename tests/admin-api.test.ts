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
});
