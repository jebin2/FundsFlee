import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { buildBplist } from "@/lib/bplist";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "change-me");

// Builds the Shortcuts plist structure for a "Log to FundsFlee" share extension shortcut.
// The shortcut receives shared text, POSTs it to /api/shortcut with the user's token,
// and shows the parsed result as a Shortcuts notification.
function buildShortcutPlist(token: string, origin: string) {
  const apiUrl = `${origin}/api/shortcut`;
  return {
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
        WFWorkflowActionParameters: {
          WFHTTPMethod:   "POST",
          ShowHeaders:    false,
          WFURL:          apiUrl,
          WFHTTPBodyType: "JSON",
          WFHTTPHeaders: {
            Value: {
              WFDictionaryFieldValueItems: [
                {
                  WFItemType: 0,
                  WFKey:   { Value: { string: "Authorization" },    WFSerializationType: "WFTextTokenString" },
                  WFValue: { Value: { string: `Bearer ${token}` }, WFSerializationType: "WFTextTokenString" },
                },
              ],
            },
            WFSerializationType: "WFDictionaryFieldValue",
          },
          WFHTTPBodyValues: {
            Value: {
              WFDictionaryFieldValueItems: [
                {
                  WFItemType: 0,
                  WFKey: { Value: { string: "text" }, WFSerializationType: "WFTextTokenString" },
                  // ￼ is the Unicode Object Replacement Character used by Shortcuts as
                  // an attachment placeholder; attachmentsByRange maps the range to the source.
                  WFValue: {
                    Value: {
                      attachmentsByRange: { "{0, 1}": { Type: "ExtensionInput" } },
                      string: "￼",
                    },
                    WFSerializationType: "WFTextTokenString",
                  },
                },
                {
                  WFItemType: 0,
                  WFKey:   { Value: { string: "source" }, WFSerializationType: "WFTextTokenString" },
                  WFValue: { Value: { string: "shortcut" }, WFSerializationType: "WFTextTokenString" },
                },
              ],
            },
            WFSerializationType: "WFDictionaryFieldValue",
          },
        },
      },
    ],
    WFWorkflowClientVersion:              "1300.0.0",
    WFWorkflowHasShortcutInputVariables:  false,
    WFWorkflowIcon: {
      WFWorkflowIconGlyphNumber: 59511,   // SF Symbol glyph
      WFWorkflowIconStartColor:  286527743, // indigo (fits in signed int32)
    },
    WFWorkflowImportQuestions:          [],
    WFWorkflowInputContentItemClasses:  ["WFStringContentItem"],
    WFWorkflowMinimumClientVersion:      900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowName:                      "Log to FundsFlee",
    WFWorkflowOutputContentItemClasses:  [],
    WFWorkflowTypes:                     ["ActionExtension"],
  };
}

// GET /api/shortcut/file?token=<jwt>
// Validates the JWT (same one used by /api/shortcut) and returns a binary .shortcut
// file with the token already embedded — no manual paste step required.
// The token is passed as a query param because the Shortcuts app downloads this URL
// without any session cookie.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.email || !payload.sheetId) throw new Error("invalid payload");
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const plist  = buildShortcutPlist(token, origin);
  const buf    = buildBplist(plist);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":        "application/x-apple-shortcut",
      "Content-Disposition": 'attachment; filename="FundsFlee.shortcut"',
      "Content-Length":      String(buf.length),
      // Don't cache — token may be rotated
      "Cache-Control":       "no-store",
    },
  });
}
