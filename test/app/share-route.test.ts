import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, test, vi } from "vitest";

// M3-P5. The share route's own decisions, over the handler directly, with
// the household boundary and the upload use case replaced. The real
// boundary, the real pipeline and the real middleware are the slow gate's
// (test/e2e/share-target.spec.ts).
//
// THE REDIRECT CONVERSION IS PINNED HERE ON PURPOSE. The route turns the
// boundary's thrown redirect into a 303 through two helpers from Next's own
// internals (isRedirectError, getURLFromRedirectError). If a Next upgrade
// moves or changes them, the first test below goes red instead of the route
// quietly answering 500 or 307.

const requireHouseholdContext = vi.fn();
const uploadStatement = vi.fn();

vi.mock("@/platform/auth/context", () => ({
  requireHouseholdContext: () => requireHouseholdContext(),
}));
vi.mock("@/modules/import/application", () => ({
  uploadStatement: (...args: unknown[]) => uploadStatement(...args),
}));

const { POST } = await import("../../src/app/(app)/import/share/route");

const CONTEXT = { householdId: "h-1", userId: "u-1" };
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "shared.pdf", {
  type: "application/pdf",
});

const share = (
  body: FormData | string,
  headers: Record<string, string> = {},
): NextRequest =>
  new NextRequest("http://127.0.0.1:3000/import/share", {
    method: "POST",
    body,
    headers: { host: "127.0.0.1:3000", ...headers },
  });

const withFile = (file: File | string = pdf()): FormData => {
  const form = new FormData();
  form.set("file", file);
  return form;
};

beforeEach(() => {
  requireHouseholdContext.mockReset();
  uploadStatement.mockReset();
  requireHouseholdContext.mockResolvedValue(CONTEXT);
  uploadStatement.mockResolvedValue({ importId: "0b5c1a2e-0000-4000-8000-000000000001" });
});

describe("the share route", () => {
  test("a redirect from the household boundary becomes a 303 to the same place, and nothing is uploaded", async () => {
    requireHouseholdContext.mockImplementation(() => {
      redirect("/sign-in?status=incomplete-signup");
    });
    const response = await POST(share(withFile()));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/sign-in?status=incomplete-signup");
    expect(uploadStatement).not.toHaveBeenCalled();
  });

  test("a shared file is handed to the upload use case unchanged and the reader is sent to its import", async () => {
    const response = await POST(share(withFile()));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/import/0b5c1a2e-0000-4000-8000-000000000001",
    );
    expect(uploadStatement).toHaveBeenCalledTimes(1);
    const [context, input] = uploadStatement.mock.calls[0] as [
      unknown,
      { fileName: string; bytes: Uint8Array },
    ];
    expect(context).toBe(CONTEXT);
    expect(input.fileName).toBe("shared.pdf");
    expect([...input.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  test("the Location is relative, so the browser stays on the host it posted to", async () => {
    const response = await POST(share(withFile()));
    expect(response.headers.get("location")?.startsWith("/")).toBe(true);
  });

  test.each([
    ["no file field", new FormData()],
    ["an empty file", withFile(new File([], "empty.pdf"))],
    ["a text value instead of a file", withFile("not a file")],
    ["a body that is not form data", "plain text"],
  ])("%s goes back to the upload with the no-file status", async (_, body) => {
    const response = await POST(share(body));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/import?status=no-file");
    expect(uploadStatement).not.toHaveBeenCalled();
  });

  test("a POST carrying another site's Origin is refused before the session or the body is read", async () => {
    const response = await POST(share(withFile(), { origin: "https://elsewhere.example" }));
    expect(response.status).toBe(403);
    expect(requireHouseholdContext).not.toHaveBeenCalled();
    expect(uploadStatement).not.toHaveBeenCalled();
  });

  // FIX ROUND 1 (findings CR-M3P5-01, HZ-001). Shipped Android Chrome sends
  // a share as a navigation with no initiator: "Origin: null" and
  // "Sec-Fetch-Site: none". The first version refused it.
  test("the phone's own share (Origin null, Sec-Fetch-Site none) is accepted", async () => {
    const response = await POST(
      share(withFile(), { origin: "null", "sec-fetch-site": "none" }),
    );
    expect(response.status).toBe(303);
    expect(uploadStatement).toHaveBeenCalledTimes(1);
  });

  test.each(["cross-site", "same-site"])(
    "Sec-Fetch-Site %s is refused even with no usable Origin",
    async (fetchSite) => {
      const response = await POST(
        share(withFile(), { origin: "null", "sec-fetch-site": fetchSite }),
      );
      expect(response.status).toBe(403);
      expect(requireHouseholdContext).not.toHaveBeenCalled();
      expect(uploadStatement).not.toHaveBeenCalled();
    },
  );

  test("an Origin that is neither a URL nor null is refused", async () => {
    const response = await POST(share(withFile(), { origin: "not a url" }));
    expect(response.status).toBe(403);
    expect(uploadStatement).not.toHaveBeenCalled();
  });

  test("a POST carrying this site's own Origin is accepted", async () => {
    const response = await POST(share(withFile(), { origin: "http://127.0.0.1:3000" }));
    expect(response.status).toBe(303);
    expect(uploadStatement).toHaveBeenCalledTimes(1);
  });
});
