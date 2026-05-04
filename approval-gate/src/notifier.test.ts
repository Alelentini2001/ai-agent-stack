import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

// Minimal JWT round-trip test for the magic-link logic in notifier.ts.
// We test the JWT signing/verification contract directly without importing
// notifier.ts (which has side-effectful imports for Resend and the file system).

const SECRET = "test-secret-must-be-at-least-32-chars!!";
const encodedSecret = new TextEncoder().encode(SECRET);

async function makeToken(payload: Record<string, unknown>, expiresIn = "24h") {
  const jti = crypto.randomUUID();
  return {
    token: await new SignJWT({ ...payload, jti })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(expiresIn)
      .setJti(jti)
      .sign(encodedSecret),
    jti,
  };
}

describe("magic-link JWT round-trip", () => {
  it("verifies a valid approve token", async () => {
    const { token } = await makeToken({ taskId: "task-123", decision: "approve" });
    const { payload } = await jwtVerify(token, encodedSecret);
    expect(payload["taskId"]).toBe("task-123");
    expect(payload["decision"]).toBe("approve");
  });

  it("verifies a valid reject token", async () => {
    const { token } = await makeToken({ taskId: "task-456", decision: "reject" });
    const { payload } = await jwtVerify(token, encodedSecret);
    expect(payload["decision"]).toBe("reject");
  });

  it("jti is present in the payload", async () => {
    const { token, jti } = await makeToken({ taskId: "t", decision: "approve" });
    const { payload } = await jwtVerify(token, encodedSecret);
    expect(payload.jti).toBe(jti);
  });

  it("rejects an expired token", async () => {
    // Use a past Unix timestamp (already expired by 10 s)
    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    const jti = crypto.randomUUID();
    const token = await new SignJWT({ taskId: "t", decision: "approve", jti })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(expiredAt)
      .setJti(jti)
      .sign(encodedSecret);
    await expect(jwtVerify(token, encodedSecret)).rejects.toThrow();
  });

  it("rejects a token signed with wrong secret", async () => {
    const { token } = await makeToken({ taskId: "t", decision: "approve" });
    const wrongSecret = new TextEncoder().encode("wrong-secret-at-least-32-chars!!!!");
    await expect(jwtVerify(token, wrongSecret)).rejects.toThrow();
  });

  it("approve and reject tokens for same task have different jti", async () => {
    const { jti: jti1 } = await makeToken({ taskId: "t", decision: "approve" });
    const { jti: jti2 } = await makeToken({ taskId: "t", decision: "reject" });
    expect(jti1).not.toBe(jti2);
  });
});
