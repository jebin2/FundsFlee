"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/types";

const categoryColors = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#AED6F1",
];

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("📦");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const sheetId = localStorage.getItem("sheetId");
    if (!sheetId) { setLoading(false); return; }
    fetch(`/api/transactions?sheetId=${sheetId}`)
      .then(() => {
        // Categories are cached locally from sheet; for now use default set
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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

  const customs = categories.filter((c) => !c.is_default && !c.parent_id);

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
              className="flex-1 px-4 py-2 rounded-xl"
              style={{ background: "#fff", fontSize: 14, color: "var(--color-on-surface)", outline: "none" }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl font-medium" style={{ background: "rgba(0,0,0,0.1)", color: "var(--color-primary)", fontSize: 14 }}>
              Cancel
            </button>
            <button
              onClick={() => {
                if (!newName.trim()) return;
                const newCat: Category = {
                  id: crypto.randomUUID(), name: newName.trim(),
                  color: categoryColors[Math.floor(Math.random() * categoryColors.length)],
                  icon: newIcon, is_default: false, created_at: new Date().toISOString(),
                };
                setCategories((prev) => [...prev, newCat]);
                setNewName(""); setNewIcon("📦"); setShowForm(false);
              }}
              className="flex-2 py-2.5 px-6 rounded-xl font-semibold"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 14, flex: 2 }}
            >
              Add
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
      {customs.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1">Custom categories</p>
          <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            {customs.map((cat, i) => (
              <div key={cat.id} className="flex items-center gap-4 px-4 py-3.5" style={{ borderBottom: i < customs.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: cat.color + "22" }}>
                  {cat.icon}
                </div>
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)", flex: 1 }}>{cat.name}</p>
                <button
                  onClick={() => setCategories((prev) => prev.filter((c) => c.id !== cat.id))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--color-error-container)" }}
                >
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
