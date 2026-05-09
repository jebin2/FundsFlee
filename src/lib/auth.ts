import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { initSpendingSheet } from "@/lib/sheets";

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token!,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return {
      ...token,
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      // Keep old refresh_token if no new one is returned
      refresh_token: data.refresh_token ?? token.refresh_token,
      error: undefined,
    };
  } catch (e) {
    console.error("Failed to refresh access token:", e);
    return { ...token, error: "RefreshTokenError" as const };
  }
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign-in
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at;
        token.error = undefined;

        try {
          const { sheetId, isNew } = await initSpendingSheet(
            account.access_token as string,
            (profile?.name as string) ?? "User"
          );
          token.sheet_id = sheetId;
          token.sheet_is_new = isNew;
        } catch (e) {
          console.error("Failed to init sheet during sign-in:", e);
        }
        return token;
      }

      // Token still valid
      if (Date.now() < (token.expires_at as number) * 1000) {
        return token;
      }

      // Token expired — refresh it
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.access_token = token.access_token as string;
      session.refresh_token = token.refresh_token as string;
      session.sheet_id = token.sheet_id as string;
      session.sheet_is_new = token.sheet_is_new as boolean;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
