// Shim for `next-auth/react` — re-exports the local auth context.
export { SessionProvider, useSession, signIn, signOut } from "@/auth/AuthContext";
export type { Session, SessionStatus } from "@/auth/AuthContext";
