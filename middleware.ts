import { NextResponse, type NextRequest } from "next/server";
import { appPassword, isValidSession, SESSION_COOKIE } from "@/lib/auth";

/** Paths reachable without a session: the login page and its API. */
const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

/**
 * When APP_PASSWORD is set, every page and API route requires the session
 * cookie. Pages redirect to /login; API routes answer 401 JSON.
 */
export async function middleware(req: NextRequest) {
  const password = appPassword();
  if (!password) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value, password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in. Reload the page to log in." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  else if (search) login.searchParams.set("next", `/${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js build assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
