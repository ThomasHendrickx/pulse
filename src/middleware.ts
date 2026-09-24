import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./platform/config";
import { SHARE_TARGET_PATH } from "./modules/import/ui/share-target";

// Session refresh plus route protection. The middleware refreshes the
// Supabase auth cookies on every matched request and keeps unauthenticated
// visitors on the auth screens. Household resolution does NOT happen here;
// that is the job of requireHouseholdContext at the route boundary.

const isAuthPath = (pathname: string): boolean =>
  pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isAuthPath(request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    // AN UNAUTHENTICATED SHARE (M3-P5, decision D-10) goes to sign-in with a
    // 303, not the default 307: a 307 makes the browser repeat the POST, with
    // the shared file in its body, at the sign-in page. A 303 turns it into
    // a plain GET, so the file is not forwarded or kept anywhere, and the
    // owner shares again after signing in. The Location is absolute here,
    // unlike the share route's, because middleware refuses a relative
    // redirect (it answers 500), and it is harmless here: this branch runs
    // only without a session, so there is no cookie a host change could
    // lose.
    if (request.nextUrl.pathname === SHARE_TARGET_PATH) {
      target.search = "";
      return NextResponse.redirect(target, 303);
    }
    return NextResponse.redirect(target);
  }

  if (user && isAuthPath(request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: [
    // manifest.webmanifest is excluded (M3-P5): the browser fetches the
    // manifest without the session cookie, and a manifest answered with a
    // redirect to sign-in makes the app uninstallable. The icons it names
    // are PNGs, already excluded by extension. The entry is anchored and its
    // dot escaped (fix round 1, finding HZ-005), so it matches that one
    // path and no path that merely begins with it.
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico)$).*)",
  ],
};
