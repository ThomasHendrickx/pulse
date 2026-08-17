import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./platform/config";

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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico)$).*)",
  ],
};
