import "next-auth";

declare module "next-auth" {
  interface Session {
    access_token: string;
    refresh_token: string;
    sheet_id: string;
    sheet_is_new: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    sheet_id?: string;
    sheet_is_new?: boolean;
  }
}
