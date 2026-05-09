import { google } from "googleapis";

export function getAuth(accessToken: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function getSheetsClient(accessToken: string) {
  return google.sheets({ version: "v4", auth: getAuth(accessToken) });
}

export function getDriveClient(accessToken: string) {
  return google.drive({ version: "v3", auth: getAuth(accessToken) });
}
