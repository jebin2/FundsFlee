import { create } from "zustand";
import type { Category, UserProfile } from "@/types";

interface ProfileState {
  profile: UserProfile | null;
  categories: Category[];
  setProfile: (profile: UserProfile) => void;
  setCategories: (cats: Category[]) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  categories: [],
  setProfile: (profile) => set({ profile }),
  setCategories: (categories) => set({ categories }),
}));
