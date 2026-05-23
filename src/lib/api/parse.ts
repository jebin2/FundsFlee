import { jsonPost } from "./http";

export const parseApi = {
  text: (text: string, region: string) =>
    jsonPost("/api/parse/text", { text, region }),
};
