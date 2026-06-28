"use client";

import { useState, useEffect, useCallback } from "react";
import { profileApi } from "@/lib/api/profile";
import { safeJsonParse } from "@/lib/safeJson";

export interface Profile {
  name: string;
  region: string;
  lifestyle_tags: string[];
  monthly_income: number | null;
  shortcut_token: string;
  shortcut_last_used: string;
}

const DEFAULT_PROFILE: Profile = {
  name: "",
  region: "",
  lifestyle_tags: [],
  monthly_income: null,
  shortcut_token: "",
  shortcut_last_used: "",
};

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await profileApi.get();
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        if (data.region) localStorage.setItem("region", data.region);
        if (data.lifestyle_tags?.length) localStorage.setItem("lifestyle_tags", JSON.stringify(data.lifestyle_tags));
      }
    } catch {
      setProfile({
        ...DEFAULT_PROFILE,
        region: localStorage.getItem("region") ?? "",
        lifestyle_tags: safeJsonParse<string[]>(localStorage.getItem("lifestyle_tags"), []),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (updates: Partial<Profile>): Promise<boolean> => {
    setSaving(true);
    try {
      const fields = Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : String(v ?? "")])
      );
      const res = await profileApi.update(fields);
      if (res.ok) {
        setProfile((prev) => ({ ...prev, ...updates }));
        if (updates.region !== undefined) localStorage.setItem("region", updates.region);
        if (updates.lifestyle_tags) localStorage.setItem("lifestyle_tags", JSON.stringify(updates.lifestyle_tags));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { profile, loading, saving, save, reload: load };
}
