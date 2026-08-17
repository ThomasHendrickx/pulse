import { describe, expect, test } from "vitest";
import { envUrlBooleans } from "../../src/platform/db/triage";

// Round 6 disclosure contract: env-derived triage data is boolean-only.
// The tests check both the derivation and that nothing of the input string
// leaks into the serialized output.

describe("envUrlBooleans", () => {
  test("recognizes a known pooler candidate on the pooler port, leaking nothing", () => {
    const input =
      "postgresql://postgres.someref:hunter2-secret@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    const booleans = envUrlBooleans(input);
    expect(booleans).toEqual({
      present: true,
      parseable: true,
      hostIsKnownPoolerCandidate: true,
      portIsPooler: true,
      hostEndsWithSupabaseDomain: true,
    });
    const serialized = JSON.stringify(booleans);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("6543");
    expect(serialized).not.toContain("someref");
  });

  test("a non-candidate supabase host is domain-true but candidate-false", () => {
    const booleans = envUrlBooleans(
      "postgresql://u:p@db.someref.supabase.co:5432/postgres",
    );
    expect(booleans.hostIsKnownPoolerCandidate).toBe(false);
    expect(booleans.hostEndsWithSupabaseDomain).toBe(true);
    expect(booleans.portIsPooler).toBe(true);
  });

  test("a non-supabase host on an odd port is false on both host booleans", () => {
    const booleans = envUrlBooleans("postgresql://u:p@db.example.com:7777/x");
    expect(booleans.hostIsKnownPoolerCandidate).toBe(false);
    expect(booleans.hostEndsWithSupabaseDomain).toBe(false);
    expect(booleans.portIsPooler).toBe(false);
  });

  test("an implicit port counts as 5432, the postgres default", () => {
    expect(
      envUrlBooleans("postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com/db")
        .portIsPooler,
    ).toBe(true);
  });

  test("absent and unparseable are told apart from a wrong host", () => {
    expect(envUrlBooleans(undefined)).toEqual({
      present: false,
      parseable: false,
      hostIsKnownPoolerCandidate: false,
      portIsPooler: false,
      hostEndsWithSupabaseDomain: false,
    });
    const unparseable = envUrlBooleans("not a url");
    expect(unparseable.present).toBe(true);
    expect(unparseable.parseable).toBe(false);
  });
});
