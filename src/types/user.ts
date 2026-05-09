export interface UserProfile {
  name: string;
  email: string;
  image?: string;
  region?: string;
  lifestyle_tags?: string[];
  monthly_income?: number;
  shortcut_token?: string;
  sheet_id?: string;
  sheet_url?: string;
}
