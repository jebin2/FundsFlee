import { google } from "googleapis";

const DEFAULTS = [
  { name: "Food & Dining",     icon: "🍽️", color: "#FF6B6B", subs: ["Restaurants", "Cafes", "Swiggy/Zomato", "Groceries"] },
  { name: "Transport",         icon: "🚗", color: "#4ECDC4", subs: ["Ola/Uber", "Fuel", "Auto", "Bus/Train", "Flight"] },
  { name: "Shopping",          icon: "🛍️", color: "#45B7D1", subs: ["Clothing", "Electronics", "Household", "Online"] },
  { name: "Entertainment",     icon: "🎬", color: "#96CEB4", subs: ["Movies", "OTT", "Events", "Games"] },
  { name: "Health",            icon: "🏥", color: "#FFEAA7", subs: ["Pharmacy", "Doctor", "Gym", "Lab Tests"] },
  { name: "Bills & Utilities", icon: "⚡", color: "#DDA0DD", subs: ["Electricity", "Mobile", "Internet", "Rent", "EMI"] },
  { name: "Education",         icon: "📚", color: "#98D8C8", subs: ["Books", "Courses", "School"] },
  { name: "Personal Care",     icon: "💆", color: "#F7DC6F", subs: ["Salon", "Spa"] },
  { name: "Gifts & Donations", icon: "🎁", color: "#BB8FCE", subs: [] },
  { name: "Others",            icon: "📦", color: "#AED6F1", subs: [] },
];

export async function seedDefaultCategories(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
): Promise<void> {
  const rows: string[][] = [];
  const now = new Date().toISOString();

  for (const cat of DEFAULTS) {
    const parentId = crypto.randomUUID();
    rows.push([parentId, cat.name, "", cat.color, cat.icon, "true", now]);
    for (const sub of cat.subs) {
      rows.push([crypto.randomUUID(), sub, parentId, cat.color, cat.icon, "true", now]);
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "categories!A2",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}
