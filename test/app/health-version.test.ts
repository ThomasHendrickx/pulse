import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GET } from "../../src/app/api/health/version/route";
import { UNSTAMPED } from "../../src/app/api/health/version/build-stamp";

// M3-P17. Covers both branches of both fields over the handler directly
// (criterion 17.1): the platform-set case and the unset/empty case, kept
// apart from each other so a reader cannot mistake the marker for a real
// value or vice versa. Also covers the response's key set (criterion 17.2):
// exactly two fields, sha and deploymentEnvironment, and nothing else.

const ORIGINAL_SHA = process.env.VERCEL_GIT_COMMIT_SHA;
const ORIGINAL_ENV = process.env.VERCEL_ENV;

const restoreEnv = () => {
  if (ORIGINAL_SHA === undefined) {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  } else {
    process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL_SHA;
  }
  if (ORIGINAL_ENV === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = ORIGINAL_ENV;
  }
};

beforeEach(() => {
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_ENV;
});

afterEach(restoreEnv);

describe("GET /api/health/version", () => {
  test("both variables set: the response carries their exact values", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    process.env.VERCEL_ENV = "production";

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.sha).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(body.deploymentEnvironment).toBe("production");
  });

  test("both variables unset: both fields are exactly the marker unstamped", async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.sha).toBe(UNSTAMPED);
    expect(body.deploymentEnvironment).toBe(UNSTAMPED);
  });

  test("both variables set to the empty string: both fields are exactly the marker unstamped", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    process.env.VERCEL_ENV = "";

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.sha).toBe(UNSTAMPED);
    expect(body.deploymentEnvironment).toBe(UNSTAMPED);
  });

  test("the marker is not a valid hexadecimal string, so it can never be taken for a commit", () => {
    expect(UNSTAMPED).toBe("unstamped");
    expect(/^[0-9a-f]+$/i.test(UNSTAMPED)).toBe(false);
  });

  test("one field present and the other absent: only the absent one is stamped", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "deadbeefcafe0123456789abcdef0123456789a";

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.sha).toBe("deadbeefcafe0123456789abcdef0123456789a");
    expect(body.deploymentEnvironment).toBe(UNSTAMPED);
  });

  test("discloses exactly two fields and nothing else", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    process.env.VERCEL_ENV = "preview";

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["deploymentEnvironment", "sha"]);
  });

  test("fix round 1, HZ-M3P17-02: the response is never cached", async () => {
    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
