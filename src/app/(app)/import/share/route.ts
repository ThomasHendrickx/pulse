import { NextResponse, type NextRequest } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { requireHouseholdContext } from "@/platform/auth/context";
import { uploadStatement } from "@/modules/import/application";
import { SHARE_TARGET_FILE_FIELD } from "@/modules/import/ui";
import type { HouseholdContext } from "@/platform/tenancy";

// The share-sheet receiving route (M3-P5, DR-0021). The installed app's
// manifest declares this path as its share_target, so sharing a PDF to
// Pulse from the phone POSTs the file here as multipart form data. It does
// what the upload action does and nothing more: resolve the household
// context, hand the file to uploadStatement unchanged, and send the reader
// into the import flow at whatever state the upload produced.
//
// EVERY REDIRECT IS 303 (See Other), never the 307 a redirect() thrown in a
// route handler produces. A 307 tells the browser to repeat the POST, with
// the shared file in its body, at the new location; a 303 tells it to GET
// the new location with no body. That is what keeps the no-preservation
// contract (decision D-10) true in the one case that reaches this handler
// without a household: the file is not forwarded anywhere.
//
// AN UNAUTHENTICATED SHARE never reaches this handler. The middleware sends
// it to sign-in with a 303 first (src/middleware.ts), so no Import row is
// created and no byte is read. After signing in, the owner shares again;
// the share sheet is one tap away (decision D-10, finding PR2-005).
//
// A CROSS-SITE POST is refused, and the refusal must not catch the phone.
// CORRECTED IN FIX ROUND 1 (findings CR-M3P5-01 and HZ-001): this comment
// said the share sheet POSTs with this site's origin. On shipped Android
// Chrome it does not: the share navigation has no initiator, so the POST
// carries "Origin: null", and the first version of this check, which
// refused any Origin that is not a URL, answered every real share 403.
// The decision now rests on Sec-Fetch-Site, which the browser sets and no
// page can: "cross-site" and "same-site" are refused, while "none" (a
// navigation the browser started, which is what a share is) and
// "same-origin" pass. An Origin header is still read when it names a URL:
// another host is refused. "null" and an absent Origin decide nothing on
// their own. (The session cookies are SameSite Lax, so a cross-site POST
// normally arrives without a session and the middleware has already sent
// it to sign-in; this check does not rely on that.)

// THE LOCATION IS RELATIVE, on purpose. An absolute URL built from
// request.url names the host the server believes it is on, which is not
// always the host the browser posted to (the dev server reports localhost
// for a request made to 127.0.0.1, and a proxy can rewrite it the same way).
// The session cookie belongs to the host the browser used, so a redirect to
// a different spelling of the same server arrives without it and lands on
// sign-in. A relative Location resolves against the URL the browser itself
// requested (RFC 9110, section 10.2.2).
const seeOther = (path: string): NextResponse =>
  new NextResponse(null, { status: 303, headers: { location: path } });

const REFUSED_FETCH_SITES: ReadonlySet<string> = new Set(["cross-site", "same-site"]);

const isCrossSite = (request: NextRequest): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && REFUSED_FETCH_SITES.has(fetchSite)) {
    return true;
  }
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") {
    return false;
  }
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isCrossSite(request)) {
    return new NextResponse(null, { status: 403 });
  }

  // The household boundary, the same call the upload action makes. Its
  // redirect (a missing or half-made session) is re-issued as a 303 so the
  // browser does not carry the file to sign-in.
  let context: HouseholdContext;
  try {
    context = await requireHouseholdContext();
  } catch (error) {
    if (isRedirectError(error)) {
      return seeOther(getURLFromRedirectError(error));
    }
    throw error;
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get(SHARE_TARGET_FILE_FIELD);
  } catch {
    // Not multipart form data at all: the same answer as an empty upload.
    return seeOther("/import?status=no-file");
  }
  if (!(file instanceof File) || file.size === 0) {
    return seeOther("/import?status=no-file");
  }

  const outcome = await uploadStatement(context, {
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return seeOther(`/import/${outcome.importId}`);
}
