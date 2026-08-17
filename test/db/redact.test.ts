import { describe, expect, test } from "vitest";
import { redactConnectionTargets } from "../../src/platform/db/redact";

// The disclosure boundary of the db health probe: no part of a connection
// string may survive redaction. Shapes taken from real Prisma and node
// driver messages.

describe("redactConnectionTargets", () => {
  test("redacts the backtick-quoted host of a Prisma P1001 message", () => {
    const redacted = redactConnectionTargets(
      "Can't reach database server at `aws-1-eu-north-1.pooler.supabase.com:5432`",
    );
    expect(redacted).not.toContain("supabase.com");
    expect(redacted).not.toContain("5432");
    expect(redacted).toContain("<redacted>");
  });

  test("redacts a full postgres URL wherever it appears", () => {
    const redacted = redactConnectionTargets(
      "invalid connection string: postgresql://user:secret@db.example.com:5432/postgres?sslmode=require",
    );
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("example.com");
    expect(redacted).toContain("<redacted-url>");
  });

  test("redacts bare ip:port from node network errors", () => {
    const redacted = redactConnectionTargets("connect ECONNREFUSED 10.1.2.3:6543");
    expect(redacted).not.toContain("10.1.2.3");
    expect(redacted).toBe("connect ECONNREFUSED <redacted-address>");
  });

  test("leaves target-free prose alone", () => {
    expect(redactConnectionTargets("Authentication failed against the database")).toBe(
      "Authentication failed against the database",
    );
  });
});
