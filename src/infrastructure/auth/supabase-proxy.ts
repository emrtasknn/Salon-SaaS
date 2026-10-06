import "server-only";

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSupabaseSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, options) {
        cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, cookieOptions);
        });
        if (options?.headers) {
          Object.entries(options.headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        }
      },
    },
  });

  await supabase.auth.getClaims();

  return response;
}
