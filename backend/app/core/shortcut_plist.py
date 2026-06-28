"""Shortcut .shortcut file builder — port of the buildShortcutPlist + bplist
logic in src/app/api/shortcut/file/route.ts (and install.shortcut/route.ts).

The Next.js app hand-rolled a binary-plist encoder (src/lib/bplist.ts); here we
use the stdlib plistlib binary writer, which produces a valid Apple bplist00 the
Shortcuts app can import. The plist *structure* is reproduced verbatim.
"""
import plistlib

# Unicode Object Replacement Character — Shortcuts uses it as an attachment
# placeholder; attachmentsByRange maps the range to the source.
_OBJECT_REPLACEMENT = "￼"


def build_shortcut_plist(token: str, origin: str) -> dict:
    api_url = f"{origin}/api/shortcut"
    return {
        "WFWorkflowActions": [
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFHTTPMethod": "POST",
                    "ShowHeaders": False,
                    "WFURL": api_url,
                    "WFHTTPBodyType": "JSON",
                    "WFHTTPHeaders": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                {
                                    "WFItemType": 0,
                                    "WFKey": {"Value": {"string": "Authorization"}, "WFSerializationType": "WFTextTokenString"},
                                    "WFValue": {"Value": {"string": f"Bearer {token}"}, "WFSerializationType": "WFTextTokenString"},
                                },
                            ],
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                    "WFHTTPBodyValues": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                {
                                    "WFItemType": 0,
                                    "WFKey": {"Value": {"string": "text"}, "WFSerializationType": "WFTextTokenString"},
                                    "WFValue": {
                                        "Value": {
                                            "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}},
                                            "string": _OBJECT_REPLACEMENT,
                                        },
                                        "WFSerializationType": "WFTextTokenString",
                                    },
                                },
                                {
                                    "WFItemType": 0,
                                    "WFKey": {"Value": {"string": "source"}, "WFSerializationType": "WFTextTokenString"},
                                    "WFValue": {"Value": {"string": "shortcut"}, "WFSerializationType": "WFTextTokenString"},
                                },
                            ],
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                },
            },
        ],
        "WFWorkflowClientVersion": "1300.0.0",
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 59511,
            "WFWorkflowIconStartColor": 286527743,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": "Log to FundsFlee",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
    }


def build_shortcut_file(token: str, origin: str) -> bytes:
    return plistlib.dumps(build_shortcut_plist(token, origin), fmt=plistlib.FMT_BINARY)
