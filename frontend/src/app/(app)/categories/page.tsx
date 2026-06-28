"use client";

import { useState, useEffect } from "react";
import type { Category } from "@/types";

const categoryColors = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#AED6F1",
];

const defaults = [
  { name: "Food & Dining", icon: "🍽️", color: "#FF6B6B", subs: ["Restaurants", "Cafes", "Swiggy/Zomato", "Groceries"] },
  { name: "Transport", icon: "🚗", color: "#4ECDC4", subs: ["Ola/Uber", "Fuel", "Auto", "Bus/Train"] },
  { name: "Shopping", icon: "🛍️", color: "#45B7D1", subs: ["Clothing", "Electronics", "Household", "Online"] },
  { name: "Entertainment", icon: "🎬", color: "#96CEB4", subs: ["Movies", "OTT", "Events", "Games"] },
  { name: "Health", icon: "🏥", color: "#FFEAA7", subs: ["Pharmacy", "Doctor", "Gym", "Lab Tests"] },
  { name: "Bills & Utilities", icon: "⚡", color: "#DDA0DD", subs: ["Electricity", "Mobile", "Internet", "Rent"] },
  { name: "Education", icon: "📚", color: "#98D8C8", subs: ["Books", "Courses", "School"] },
  { name: "Personal Care", icon: "💆", color: "#F7DC6F", subs: ["Salon", "Spa"] },
  { name: "Gifts & Donations", icon: "🎁", color: "#BB8FCE", subs: [] },
  { name: "Others", icon: "📦", color: "#AED6F1", subs: [] },
];

export default function CategoriesPage() {
  const [customCategories, setCustomCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("📦");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        const cats: Category[] = d.categories ?? [];
        setCustomCategories(cats.filter((c) => !c.is_default && !c.parent_id));
      })
      .catch(() => {});
  }, []);

  async function addCategory() {
    if (!newName.trim() || saving) return;
    setSaving(true);
    const newCat: Category = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: categoryColors[Math.floor(Math.random() * categoryColors.length)],
      icon: newIcon,
      is_default: false,
      created_at: new Date().toISOString(),
    };
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCat),
      });
      if (!res.ok) throw new Error("Save failed");
      setCustomCategories((prev) => [...prev, newCat]);
      setNewName("");
      setNewIcon("📦");
      setShowForm(false);
    } catch {
      // Keep form open so user can retry
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(id: string) {
    try {
      await fetch(`/api/categories/${id}`, { method: "DELETE" });
      setCustomCategories((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // Silently ignore — optimistic delete would have been fine anyway
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }}>Categories</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-full font-medium text-sm flex items-center gap-1.5"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          Add custom
        </button>
      </div>

      {/* Add custom form */}
      {showForm && (
        <div className="rounded-2xl p-4 border flex flex-col gap-3" style={{ borderColor: "var(--color-primary)", background: "var(--color-primary-fixed)" }}>
          <p style={{ fontWeight: 600, color: "var(--color-primary)", fontSize: 14 }}>New category</p>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Emoji icon"
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value)}
              className="w-16 text-center px-2 py-2 rounded-xl"
              style={{ background: "#fff", fontSize: 20, outline: "none" }}
            />
            <input
              type="text"
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              className="flex-1 px-4 py-2 rounded-xl"
              style={{ background: "#fff", fontSize: 14, color: "var(--color-on-surface)", outline: "none" }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium"
              style={{ background: "rgba(0,0,0,0.1)", color: "var(--color-primary)", fontSize: 14 }}>
              Cancel
            </button>
            <button onClick={addCategory} disabled={!newName.trim() || saving}
              className="py-2.5 px-6 rounded-xl font-semibold"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 14, flex: 2, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
        </div>
      )}

      {/* Default categories */}
      <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Default categories</p>
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        {defaults.map((cat, i) => (
          <div key={cat.name} className="flex items-center gap-4 px-4 py-3.5" style={{ borderBottom: i < defaults.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: cat.color + "22" }}>
              {cat.icon}
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)" }}>{cat.name}</p>
              {cat.subs.length > 0 && (
                <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{cat.subs.slice(0, 3).join(", ")}{cat.subs.length > 3 ? "…" : ""}</p>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-outline)" }}>
              {cat.subs.length > 0 ? `${cat.subs.length} subs` : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Custom categories */}
      {customCategories.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Custom categories</p>
          <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            {customCategories.map((cat, i) => (
              <div key={cat.id} className="flex items-center gap-4 px-4 py-3.5"
                style={{ borderBottom: i < customCategories.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: (cat.color ?? "#AED6F1") + "22" }}>
                  {cat.icon ?? "📦"}
                </div>
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)", flex: 1 }}>{cat.name}</p>
                <button onClick={() => deleteCategory(cat.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--color-error-container)" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 16 }}>delete</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
