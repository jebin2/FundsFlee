import { jsonPut } from "./http";

export const profileApi = {
  get: () => fetch("/api/user/profile"),

  update: (fields: Record<string, string>) =>
    jsonPut("/api/user/profile", fields),
};
