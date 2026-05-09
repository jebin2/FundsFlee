import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";
import { initSpendingSheet } from "@/lib/sheets";

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
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at;

        // Resolve (or create) the user's sheet at sign-in time so API routes
        // never need sheetId from the client.
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
      }
      return token;
    },
    async session({ session, token }) {
      session.access_token = token.access_token as string;
      session.refresh_token = token.refresh_token as string;
      session.sheet_id = token.sheet_id as string;
      session.sheet_is_new = token.sheet_is_new as boolean;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
