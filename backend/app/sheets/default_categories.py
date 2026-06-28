"""Default category seed — port of src/lib/sheets/schema/defaultCategories.ts."""
import uuid

from app.core.dates import now_iso
from app.sheets.client import run_sheets

DEFAULTS = [
    {"name": "Food & Dining",     "icon": "🍽️", "color": "#FF6B6B", "subs": ["Restaurants", "Cafes", "Swiggy/Zomato", "Groceries"]},
    {"name": "Transport",         "icon": "🚗", "color": "#4ECDC4", "subs": ["Ola/Uber", "Fuel", "Auto", "Bus/Train", "Flight"]},
    {"name": "Shopping",          "icon": "🛍️", "color": "#45B7D1", "subs": ["Clothing", "Electronics", "Household", "Online"]},
    {"name": "Entertainment",     "icon": "🎬", "color": "#96CEB4", "subs": ["Movies", "OTT", "Events", "Games"]},
    {"name": "Health",            "icon": "🏥", "color": "#FFEAA7", "subs": ["Pharmacy", "Doctor", "Gym", "Lab Tests"]},
    {"name": "Bills & Utilities", "icon": "⚡", "color": "#DDA0DD", "subs": ["Electricity", "Mobile", "Internet", "Rent", "EMI"]},
    {"name": "Education",         "icon": "📚", "color": "#98D8C8", "subs": ["Books", "Courses", "School"]},
    {"name": "Personal Care",     "icon": "💆", "color": "#F7DC6F", "subs": ["Salon", "Spa"]},
    {"name": "Gifts & Donations", "icon": "🎁", "color": "#BB8FCE", "subs": []},
    {"name": "Others",            "icon": "📦", "color": "#AED6F1", "subs": []},
]


def seed_default_categories_sync(sheets, sheet_id: str) -> None:
    rows: list[list[str]] = []
    now = now_iso()

    for cat in DEFAULTS:
        parent_id = str(uuid.uuid4())
        rows.append([parent_id, cat["name"], "", cat["color"], cat["icon"], "true", now])
        for sub in cat["subs"]:
            rows.append([str(uuid.uuid4()), sub, parent_id, cat["color"], cat["icon"], "true", now])

    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="categories!A2",
        valueInputOption="RAW",
        body={"values": rows},
    ).execute()


async def seed_default_categories(sheets, sheet_id: str) -> None:
    await run_sheets(lambda: seed_default_categories_sync(sheets, sheet_id))
