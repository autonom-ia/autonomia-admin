import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOrganization } from "../src/types.js";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn(() => ({ send: sendMock })),
  SendMessageCommand: vi.fn((input) => ({ input }))
}));

describe("auth sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_SYNC_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/123/auth-sync");
    sendMock.mockReset();
  });

  it("publishes organization upserts to Auth", async () => {
    const { publishOrganizationAuthUpserted } = await import("../src/auth-sync.js");
    const organization: AdminOrganization = {
      id: "14002337-5763-4000-8000-000000000002",
      key: "hub2you",
      name: "Hub2You",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    const event = await publishOrganizationAuthUpserted(organization);

    expect(event).toMatchObject({
      eventType: "admin.organization.upserted",
      source: "admin",
      data: {
        organizationId: organization.id,
        organizationKey: "hub2you",
        name: "Hub2You",
        status: "active"
      }
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]?.[0] as { input?: { MessageBody?: string; QueueUrl?: string } };
    expect(command.input?.QueueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123/auth-sync");
    expect(JSON.parse(command.input?.MessageBody ?? "{}")).toMatchObject(event);
  });
});
