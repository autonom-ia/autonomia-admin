import { describe, expect, it, vi } from "vitest";
import { AdminRepository } from "../src/repository.js";

describe("user profile selection", () => {
  it("requires both supplied selectors to identify the same profile", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new AdminRepository({ query } as never);
    await expect(repository.findProfile({ profileId: "old", profileKey: "financial" })).rejects.toThrow();
    expect(query.mock.calls[0]?.[0]).toContain("AND ($1::uuid IS NULL OR id = $1::uuid)");
    expect(query.mock.calls[0]?.[0]).toContain("AND ($2::text IS NULL OR key = $2::text)");
  });
  it("allows only the already assigned inactive profile to be retained", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new AdminRepository({ query } as never);
    await expect(repository.findProfile({ profileKey: "financial" }, "current-profile")).rejects.toThrow();
    expect(query.mock.calls[0]?.[1]).toEqual([null, "financial", "current-profile"]);
    expect(query.mock.calls[0]?.[0]).toContain("status = 'active' OR id = $3::uuid");
  });
});
