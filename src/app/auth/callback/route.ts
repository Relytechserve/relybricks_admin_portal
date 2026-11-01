import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isRecoveryOtpType, safeNextPath } from "@/lib/recovery-link";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));
  const successUrl = `${origin}${next}`;
  const failureUrl =
    next === "/reset-password"
      ? `${origin}/reset-password?error=access_denied&error_code=otp_expired`
      : `${origin}/login?error=auth`;

  const hasCode = Boolean(code);
  const hasOtp = Boolean(tokenHash && isRecoveryOtpType(type));
  if (!hasCode && !hasOtp) {
    return NextResponse.redirect(failureUrl);
  }

  const cookieStore = await cookies();
  const pendingCookies: CookieToSet[] = [];
  let response = NextResponse.redirect(successUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
            const existing = pendingCookies.findIndex((cookie) => cookie.name === name);
            if (existing >= 0) pendingCookies.splice(existing, 1);
            pendingCookies.push({ name, value, options });
          });
          // Rebuild the redirect so every cookie written during the exchange
          // is on the response the browser actually follows.
          response = NextResponse.redirect(successUrl);
          pendingCookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
    return NextResponse.redirect(failureUrl);
  }

  if (tokenHash && isRecoveryOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) return response;
  }

  return NextResponse.redirect(failureUrl);
}
