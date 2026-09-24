// GENERATED FILE — do not edit by hand.
// Regenerate with `npm run generate:mcp-schemas` (scripts/generate-mcp-schemas.ts)
// after changing Widget/Variable/Plugin in shared/types.ts.

export const MCP_SCHEMAS = {
  "Widget": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/Widget",
    "definitions": {
      "Widget": {
        "anyOf": [
          {
            "$ref": "#/definitions/ButtonWidget"
          },
          {
            "$ref": "#/definitions/MorphButtonWidget"
          },
          {
            "$ref": "#/definitions/BarGaugeWidget"
          },
          {
            "$ref": "#/definitions/ArcGaugeWidget"
          },
          {
            "$ref": "#/definitions/AdjusterSliderWidget"
          },
          {
            "$ref": "#/definitions/AdjusterKnobWidget"
          },
          {
            "$ref": "#/definitions/EncoderWidget"
          },
          {
            "$ref": "#/definitions/RockerSwitchWidget"
          },
          {
            "$ref": "#/definitions/DialSwitchWidget"
          },
          {
            "$ref": "#/definitions/ToggleSwitchWidget"
          },
          {
            "$ref": "#/definitions/DropdownWidget"
          },
          {
            "$ref": "#/definitions/ScreenCaptureWidget"
          },
          {
            "$ref": "#/definitions/DcsViewportWidget"
          },
          {
            "$ref": "#/definitions/LabelWidget"
          },
          {
            "$ref": "#/definitions/LineWidget"
          }
        ]
      },
      "ButtonWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "button"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "doublePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "triplePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "doublePress",
              "triplePress"
            ],
            "additionalProperties": false,
            "description": "Interaction moments a button can fire a sequence from — press (pointerdown) and release (pointerup/cancel/leave) always fire immediately, zero added latency. doublePress/triplePress are optIN by being non-empty: whenever EITHER has any steps, a tap is held back for a short window (see useMultiPressArbiter in ClientCanvas.tsx) to see if a second/third tap follows, and exactly one of press/doublePress/ triplePress fires once that's decided — never press AND doublePress for the same physical double-tap. With both empty (the common case, and every dashboard saved before these existed), that window never opens at all — press fires the instant it's pressed, same as always. See SequenceStep; any of the four can be empty (no steps configured)."
          },
          "statesEnabled": {
            "type": "boolean",
            "description": "Off (default): only \"states[0]\" is editable; a lightened version of its color stands in for \"clicked\" automatically. On: every state is exposed and independently configurable in the properties panel."
          },
          "states": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetState"
            }
          },
          "activeStateExpr": {
            "type": "string",
            "description": "Optional JS expression (see shared/expr.ts) returning the exact `name` of the state that should be the \"base\" state on the client — e.g. `return variables.BATTERY_SW === 0 ? 'Default' : 'Active';`. Only meaningful when statesEnabled is on; falls back to states[0] if unset, throws, or names a state that doesn't exist. Independent of isClicked — the resolved state still gets swapped for the Clicked one while pressed."
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the button in place around its own center; degrees, clockwise, 0 is unrotated — same convention as RockerSwitchWidget.rotateAngle. Its labels (part of each WidgetState, rendered inside the same rotated element) rotate along with it; there's no separate widget-level labels array here to keep upright the way the rocker's legend does."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "events",
          "states"
        ],
        "additionalProperties": false
      },
      "SequenceStep": {
        "anyOf": [
          {
            "$ref": "#/definitions/DelayStep"
          },
          {
            "$ref": "#/definitions/ActionStep"
          },
          {
            "$ref": "#/definitions/ConditionStep"
          }
        ]
      },
      "DelayStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "delay"
          },
          "id": {
            "type": "string"
          },
          "delayMs": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "id",
          "delayMs"
        ],
        "additionalProperties": false,
        "description": "A pause between two steps in an event's sequence (see SequenceStep) — not a field on the following action step, so it can be added/removed/ reordered as its own list entry, independent of whatever action (if any) comes after it."
      },
      "ActionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "action"
          },
          "id": {
            "type": "string"
          },
          "action": {
            "$ref": "#/definitions/WidgetAction"
          }
        },
        "required": [
          "kind",
          "id",
          "action"
        ],
        "additionalProperties": false,
        "description": "One WidgetAction embedded in an event's sequence. `id` is independent of anything inside `action` — stable list identity for the properties panel's reorder/delete, same convention as WidgetLabel.id/WidgetState.id."
      },
      "WidgetAction": {
        "anyOf": [
          {
            "$ref": "#/definitions/NoneAction"
          },
          {
            "$ref": "#/definitions/KeypressAction"
          },
          {
            "$ref": "#/definitions/UpdateStateAction"
          },
          {
            "$ref": "#/definitions/SendDcsCommandAction"
          },
          {
            "$ref": "#/definitions/NavigateSubDeckAction"
          },
          {
            "$ref": "#/definitions/OpenOverlayAction"
          },
          {
            "$ref": "#/definitions/CloseOverlayAction"
          },
          {
            "$ref": "#/definitions/CallRestAction"
          },
          {
            "$ref": "#/definitions/SetWindowsAudioAction"
          },
          {
            "$ref": "#/definitions/PlaySoundAction"
          }
        ]
      },
      "NoneAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "none"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "The default for a freshly-added sequence step — does nothing when run (see runActionStep in main/index.ts). Lets a step exist as a placeholder (e.g. mid-sequence, or while deciding what it should do) without silently firing a keypress with no keys bound, which is what an empty-default KeypressAction used to do."
      },
      "KeypressAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "keypress"
          },
          "keys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "mode": {
            "type": "string",
            "enum": [
              "press",
              "down",
              "up"
            ],
            "description": "'press' (default when omitted): atomic press-then-release — the only behavior that existed before this field, still what every existing widget does. 'down'/'up' press or release only, with nothing pairing them automatically — pairing a 'down' step with a later 'up' step (typically with a DelayStep between them, see SequenceStep) is how an \"advanced\" held-key sequence is built, using the same generic sequence mechanism as any other multi-step action rather than a separate editor."
          }
        },
        "required": [
          "kind",
          "keys"
        ],
        "additionalProperties": false
      },
      "UpdateStateAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "update-state"
          },
          "code": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "code"
        ],
        "additionalProperties": false,
        "description": "JS function body, evaluated (see shared/expr.ts) with `states` — the current value of every Variable, keyed by name — in scope. Runs server-side on trigger (see main/index.ts's triggerAction); the returned value is expected to be a plain object of {variableName: newValue}, and every key present gets merged into Dashboard.variables (creating new variables for names that don't exist yet). More action kinds (macro, REST call, ...) can join this union later."
      },
      "SendDcsCommandAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "send-dcs-command"
          },
          "aircraft": {
            "type": "string"
          },
          "identifier": {
            "type": "string"
          },
          "interface": {
            "$ref": "#/definitions/DcsBiosInputInterface"
          },
          "argument": {
            "type": "string"
          },
          "argumentExpr": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "aircraft",
          "identifier",
          "interface",
          "argument"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'dcsbios' is enabled in Settings (see appSettings.ts) — or if a widget already has one configured, so disabling the kind later doesn't silently break existing buttons. `aircraft` scopes which aircraft's command catalog this was picked from (independent of any Plugin — a button isn't tied to one), so re-opening the editor can re-fetch/highlight the same command. `interface` is carried alongside `identifier` since the same identifier can expose more than one interface (e.g. a switch commonly has both `action`/TOGGLE and `set_state`/an explicit position) — each is a wholly separate selectable command with its own argument shape. `argument` is the static value sent unless `argumentExpr` is set, in which case that's evaluated (see shared/expr.ts's tryEvaluateExpression, same mechanism as UpdateStateAction.code) with `variables` in scope and the result sent instead — same fx-toggle pattern as an PluginMapping's own `expr`."
      },
      "DcsBiosInputInterface": {
        "type": "string",
        "enum": [
          "set_state",
          "fixed_step",
          "action",
          "variable_step"
        ]
      },
      "NavigateSubDeckAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "navigate-subdeck"
          },
          "target": {
            "$ref": "#/definitions/SubDeckTarget"
          }
        },
        "required": [
          "kind",
          "target"
        ],
        "additionalProperties": false,
        "description": "Switches which deck view is fullscreen on the triggering client — same visual effect as picking a different deck from the deck picker, but instant (no socket reconnect) since a sub-deck lives in the same Dashboard document (see SubDeck below). Client-local: two devices connected to the same deck can be on two different views at once (see runActionStep in main/index.ts, which replies to the triggering WebSocket only, never broadcasts this). Implicitly closes any open overlay (see OpenOverlayAction) — a fullscreen switch replaces the whole view an overlay would have been layered on top of."
      },
      "SubDeckTarget": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "main-deck"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "sub-deck"
              },
              "subDeckId": {
                "type": "string"
              }
            },
            "required": [
              "type",
              "subDeckId"
            ],
            "additionalProperties": false
          }
        ],
        "description": "Which deck view an action targets: the deck's own main view (its root `widgets`), or one specific sub-deck by id. A tiny discriminated union rather than a bare nullable id string so \"go back to the main deck\" is a real, self-documenting case instead of a magic null/empty-string sentinel. Named distinctly from ScreenRegion/ScreenCaptureWidget's \"screen\" (a physical monitor) — this is a deck-internal view, unrelated."
      },
      "OpenOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "open-overlay"
          },
          "subDeckId": {
            "type": "string"
          },
          "edge": {
            "$ref": "#/definitions/OverlayEdge"
          },
          "size": {
            "type": "number"
          },
          "sizeUnit": {
            "$ref": "#/definitions/OverlaySizeUnit"
          }
        },
        "required": [
          "kind",
          "subDeckId",
          "edge",
          "size",
          "sizeUnit"
        ],
        "additionalProperties": false,
        "description": "Slides a sub-deck in as a panel anchored to one edge of the screen, layered over whatever's currently fullscreen — a lighter-weight alternative to NavigateSubDeckAction for e.g. a settings/menu panel that shouldn't replace the whole view. Always names a specific sub-deck (unlike NavigateSubDeckAction.target, there's no 'main-deck' case here — \"slide the main deck in as a panel over itself\" isn't a meaningful action). Only one overlay open at a time on a given client; opening a second one replaces whichever was already open, and the client also supports dismissing it locally (tap outside, no server round trip) — see CloseOverlayAction for the explicit, sequenceable alternative meant for a close/back button placed inside the panel itself."
      },
      "OverlayEdge": {
        "type": "string",
        "enum": [
          "top",
          "bottom",
          "left",
          "right"
        ]
      },
      "OverlaySizeUnit": {
        "type": "string",
        "enum": [
          "px",
          "percent"
        ]
      },
      "CloseOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "close-overlay"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "Dismisses whichever overlay (if any) is currently open on the device that triggers this — a no-op if none is open. Round-trips through the server like every other action kind (rather than being intercepted client-side) so it composes with delays/other steps in the same sequence, same reasoning as NavigateSubDeckAction/OpenOverlayAction."
      },
      "CallRestAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "call-rest"
          },
          "targetId": {
            "type": "string"
          },
          "values": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/CallRestPlaceholderValue"
            }
          }
        },
        "required": [
          "kind",
          "targetId",
          "values"
        ],
        "additionalProperties": false,
        "description": "Posts a configured RestWebhookTarget's payload (see main/index.ts's runCallRestAction). Only offered in the properties panel for a currently-enabled RestWebhookTarget — or if a widget already has one configured, so disabling/deleting the target later doesn't silently break existing buttons (same convention SendDcsCommandAction's own comment describes for 'dcsbios')."
      },
      "CallRestPlaceholderValue": {
        "type": "object",
        "properties": {
          "placeholder": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "expr": {
            "type": "string"
          }
        },
        "required": [
          "placeholder",
          "value"
        ],
        "additionalProperties": false,
        "description": "One placeholder's resolved value within a CallRestAction — same value/argumentExpr split as SendDcsCommandAction.argument/argumentExpr: `expr` (when set) takes precedence over the static `value`. `placeholder` matches a {{name}} token found in the target RestWebhookTarget's payloadTemplate OR any of its headers' own values at execution time (see extractAllPlaceholders in shared/restPlaceholders.ts) — a stale entry whose token no longer exists anywhere is simply ignored, not an error."
      },
      "SetWindowsAudioAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "set-windows-audio"
          },
          "deviceName": {
            "type": "string"
          },
          "appName": {
            "type": "string"
          },
          "volume": {
            "type": "string"
          },
          "volumeExpr": {
            "type": "string"
          },
          "muteAction": {
            "type": "string",
            "enum": [
              "mute",
              "unmute",
              "toggle"
            ]
          }
        },
        "required": [
          "kind",
          "deviceName"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'windowsAudio' is enabled in Settings — or if a widget already has one configured, same don't-silently-break-an-existing-button convention SendDcsCommandAction's own comment describes for 'dcsbios'. `deviceName` is '' for \"whichever device is currently the default output\" or an exact name from windows-audio:devices — native-sound-mixer's Device has no stable id (see main/windowsAudio/worker.ts's own comment), so name is the only handle there is; renaming/replacing hardware can silently break a by-name pick, same risk a REST source's own free-text field carries. `volume` is the static 0-100 value sent unless `volumeExpr` is set, same plain-value/expr-override precedence as SendDcsCommandAction.argument/ argumentExpr; both unset means \"don't touch volume, only muteAction (if set)\". `muteAction` is a tri-state action rather than a plain boolean so \"leave mute alone\" (undefined) is distinguishable from \"unmute\" (false would be ambiguous with \"not set\" otherwise). `appName` is undefined for device mode (the shape above) or set to target one application's own audio session instead — see windows-audio:sessions for where its options come from. Additive rather than a nested discriminated union so an action saved before app-session targeting existed still reads the same (device mode, `deviceName` as before) with no migration needed. A session is always on whichever device is CURRENTLY the system default (see main/windowsAudio/connectionManager.ts's own comment on why), so `deviceName` is simply ignored while `appName` is set."
      },
      "PlaySoundAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "play-sound"
          },
          "soundId": {
            "type": "string",
            "description": "A CustomSound.id. An id whose sound has since been deleted plays nothing rather than erroring — same silent-no-op posture as a missing font, since a sound failing to play shouldn't abort the rest of a sequence mid-flight."
          },
          "target": {
            "type": "string",
            "enum": [
              "server",
              "client",
              "both"
            ]
          },
          "serverVolume": {
            "type": "number",
            "description": "0-100 each, independent: the PC's speakers and a tablet in the cockpit are rarely at a comparable level, so one shared number would mean getting one of them wrong. Converted to HTMLAudioElement gain by soundVolumeToGain (shared/sounds.ts)."
          },
          "clientVolume": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "soundId",
          "target",
          "serverVolume",
          "clientVolume"
        ],
        "additionalProperties": false,
        "description": "Plays one sound from the app-wide library (see shared/sounds.ts) — on the machine running Boarderoni, on the device that triggered the action, or both. There's no main-process audio API, so \"server\" playback is really the editor window's own renderer doing it (see playSoundOnServer in main/index.ts); the editor window is hidden-not-destroyed when minimized to tray, so this still works with no window on screen."
      },
      "ConditionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "condition"
          },
          "id": {
            "type": "string"
          },
          "condition": {
            "type": "string"
          },
          "whenTrue": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          },
          "whenFalse": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          }
        },
        "required": [
          "kind",
          "id",
          "condition",
          "whenTrue",
          "whenFalse"
        ],
        "additionalProperties": false,
        "description": "A boolean fork inside an event's sequence — evaluates `condition` (same mechanism as UpdateStateAction.code; see evaluateConditionStep in main/index.ts) and runs one of two nested SequenceStep[] branches instead of falling through to the next flat entry. This is the only place SequenceStep is recursive. `id` is independent of both branches' own step ids, same convention as every other step kind."
      },
      "WidgetState": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string",
            "description": "When set, evaluated (see resolveColor in shared/expr.ts) with `states` in scope and used instead of `color` — a JS expression instead of a fixed value, e.g. to derive this look from a Variable's current value."
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string",
            "description": "Same idea as colorExpr, but for borderColor (see resolveBorderColor in shared/expr.ts). Independent of colorExpr — a widget can have a static background with an expression-driven border, or vice versa."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          },
          "spacingTop": {
            "type": "number",
            "description": "Per-side inset (px) on top of the widget's own x/y/w/h. Negative values (down to -1) expand the box outward instead of shrinking it."
          },
          "spacingRight": {
            "type": "number"
          },
          "spacingBottom": {
            "type": "number"
          },
          "spacingLeft": {
            "type": "number"
          },
          "radiusTopLeft": {
            "type": "number",
            "description": "Per-corner border radius (px)."
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number",
            "description": "Per-side border thickness (px) — 0 removes that side's border entirely (used by morph auto-fit to drop the border on a seam between two touching blocks, on top of the -1 spacing/0 radius there)."
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "zIndex": {
            "type": "number",
            "description": "CSS z-index override for this state, independent of every other state's — e.g. a \"Clicked\" state can pop above neighboring widgets while held, overriding the default paint-order stacking (see useDashboardStore's bringToFront/sendToBack for the array-order fallback every widget uses when this is unset)."
          },
          "isClicked": {
            "type": "boolean",
            "description": "Marks the one state that plays while the button is held on a client (see getEffectiveStates in shared/states.ts) — a structural flag, not derived from `name`, so renaming some other state to \"Clicked\" doesn't make it activate on tap. Set only on the state created by enabling states the first time, or by \"Reset states\"; never on a manually-added state."
          },
          "glowColor": {
            "type": "string",
            "description": "Off by default (no glow at all) until a color is actually picked — same \"unset renders as if the field didn't exist\" convention as innerBezelRadius elsewhere, so a dashboard saved before this existed renders unchanged. See resolveGlowColor in shared/expr.ts for how glowColorExpr overrides glowColor, same colorExpr/color relationship ColorAppearance's own fields have."
          },
          "glowColorExpr": {
            "type": "string"
          },
          "glowOpacity": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "name",
          "labels"
        ],
        "additionalProperties": false,
        "description": "A named, independently-styled visual variant of a widget. \"Default\" (the first entry, always present) is the idle look; \"Clicked\" (conventionally the second entry) is shown while the button is held on the client. Anything past those two is inert for now — no runtime mechanism switches to them yet, that's future state-machine work — but they're fully editable so design work can get ahead of it."
      },
      "WidgetLabel": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "text": {
            "type": "string"
          },
          "textExpr": {
            "type": "string",
            "description": "When set, evaluated (see resolveLabelText in shared/expr.ts) and used instead of `text` — same expression mechanism as ColorAppearance's colorExpr below, just returning display text instead of a color."
          },
          "fontFamily": {
            "type": "string"
          },
          "fontSize": {
            "type": "number"
          },
          "textColor": {
            "type": "string"
          },
          "textColorExpr": {
            "type": "string",
            "description": "Same idea as ColorAppearance's colorExpr (see resolveTextColor in shared/expr.ts) — independent of textExpr, which drives the label's displayed text content, not its color."
          },
          "textOpacity": {
            "type": "number"
          },
          "backgroundColor": {
            "type": "string",
            "description": "The label's own background fill, independent of whatever widget it sits on top of. Unset (the default) is fully transparent — see renderWidgetLabel in labels.tsx, which skips withOpacity entirely rather than resolving a literal 'transparent' through it. No colorExpr/auto mode, matching ColorPickerButton's own \"plain background color field\" precedent (no derived value to fall back to here)."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "align": {
            "$ref": "#/definitions/HorizontalAlign",
            "description": "Where this label's box sits within the widget it belongs to (or, for a detent-anchored label, within its own small wrapper — see labelAnchor below)."
          },
          "verticalAlign": {
            "$ref": "#/definitions/VerticalAlign"
          },
          "textAlign": {
            "$ref": "#/definitions/HorizontalAlign",
            "description": "How the text itself is set within that box — independent of `align` above, so e.g. a label box pinned to the right edge can still have its (possibly multi-line, via a ␤ token) text centered within itself rather than also hugging the right. Unset defaults to `align`, matching the single shared value this used to be before the two were split."
          },
          "padding": {
            "type": "number"
          },
          "rotation": {
            "type": "number",
            "enum": [
              0,
              90,
              180,
              270
            ],
            "description": "Spins just this label's own text in place (around its box's own center) — independent of align/verticalAlign, which position the box itself, and of a switch widget's own rotateAngle (e.g. RockerSwitchWidget's whole-body spin in RockerSwitchWidget.tsx), which spins the widget's shape/segments and every label together rather than one label on its own. Unset/0 is the default, unrotated."
          },
          "labelAnchor": {
            "type": "string",
            "enum": [
              "top",
              "bottom",
              "left",
              "right"
            ],
            "description": "DialSwitchWidget only — where THIS label sits relative to its position's detent dot. Unset (the default) places it radially outward along that detent's own angle, just past the dial's rim, so it reads correctly regardless of which side of the ring it's on. A fixed side instead pins just this one label there, independent of every other label — e.g. one label that collides with something else on the dashboard can be pinned aside without disturbing the rest (including its own position's other labels, if it has more than one)."
          },
          "labelDistance": {
            "type": "number",
            "description": "DialSwitchWidget only — how far THIS label sits from its detent dot, in the same 0-100 viewBox units as DialSwitchWidget.detentRadius. Only affects automatic (radial) placement, i.e. labelAnchor unset — a label pinned to a fixed side ignores this. Unset uses the fixed LABEL_OFFSET."
          },
          "offsetX": {
            "type": "number",
            "description": "Nudges this label's box by a fixed pixel amount, independent of align/verticalAlign/padding above — negative moves left/up. Applied on top of whatever those already produce, including DialSwitchWidget's own radial/fixed-side placement."
          },
          "offsetY": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "text"
        ],
        "additionalProperties": false,
        "description": "Each label is an independently-styled/positioned text layer within the button's box — no auto-stacking, so two labels sharing the same align/verticalAlign simply overlap. Keybindings stay on the widget itself (see ButtonWidget.action) since they trigger the button, not a label."
      },
      "HorizontalAlign": {
        "type": "string",
        "enum": [
          "left",
          "center",
          "right"
        ]
      },
      "VerticalAlign": {
        "type": "string",
        "enum": [
          "top",
          "center",
          "bottom"
        ]
      },
      "MorphButtonWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "morph"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "cellW": {
            "type": "number"
          },
          "cellH": {
            "type": "number"
          },
          "blocks": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/MorphBlock"
            }
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "move": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release"
            ],
            "additionalProperties": false,
            "description": "Same press/release event model as ButtonWidget — shared by the whole fused-block widget, one pair of sequences for all blocks. `move` is optional (existing saved dashboards predate it) and only meaningful when isMorphSliderActive(widget) (see shared/morph.ts) — read sites default a missing array to [], same as a missing `move` kind on any other non-adjuster widget already falls back to \"no steps.\""
          },
          "statesEnabled": {
            "type": "boolean"
          },
          "states": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetState"
            }
          },
          "activeStateExpr": {
            "type": "string"
          },
          "sliderEnabled": {
            "type": "boolean",
            "description": "Opt-in drag handle that follows the shape's own longest block-to-block path (see findMorphSliderPath in shared/morph.ts) — only meaningful, and only ever actually active, when the shape is a loop-free path of 2+ blocks; see isMorphSliderActive, the single source of truth for whether the slider actually renders/fires regardless of this flag."
          },
          "valueExpr": {
            "type": "string",
            "description": "Same meaning as AdjusterWidget.valueExpr below: where the handle sits (0-100, along the path) while not being dragged, e.g. reflecting another variable back into the visual. Falls back to 0 if unset or unresolved."
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "cellW",
          "cellH",
          "blocks",
          "events",
          "states"
        ],
        "additionalProperties": false,
        "description": "A button whose hit area is a union of grid blocks rather than one rectangle — e.g. a U-shaped run of blocks that still triggers one action and shows one label/state, like several ButtonWidgets fused into one. cellW/cellH size every block uniformly; there's no per-block size. Labels, keys, and the states list itself are shared by the whole widget (one set of states for all blocks) — color, spacing, radius, and border (via perState on each block) can all differ block to block."
      },
      "MorphBlock": {
        "type": "object",
        "properties": {
          "col": {
            "type": "number"
          },
          "row": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "perState": {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/definitions/MorphBlockStateOverride"
            }
          }
        },
        "required": [
          "col",
          "id",
          "perState",
          "row"
        ],
        "additionalProperties": false,
        "description": "One base cell of a morph button. Its appearance can differ per widget state (e.g. auto-fit merged in \"Default\", manually pulled apart in some other state) — keyed by WidgetState.id rather than a parallel array so reordering/adding/removing states doesn't require reindexing every block."
      },
      "MorphBlockStateOverride": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string",
            "description": "When set, evaluated (see resolveColor in shared/expr.ts) with `states` in scope and used instead of `color` — a JS expression instead of a fixed value, e.g. to derive this look from a Variable's current value."
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string",
            "description": "Same idea as colorExpr, but for borderColor (see resolveBorderColor in shared/expr.ts). Independent of colorExpr — a widget can have a static background with an expression-driven border, or vice versa."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          },
          "spacingTop": {
            "type": "number",
            "description": "Per-side inset (px) on top of the widget's own x/y/w/h. Negative values (down to -1) expand the box outward instead of shrinking it."
          },
          "spacingRight": {
            "type": "number"
          },
          "spacingBottom": {
            "type": "number"
          },
          "spacingLeft": {
            "type": "number"
          },
          "radiusTopLeft": {
            "type": "number",
            "description": "Per-corner border radius (px)."
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number",
            "description": "Per-side border thickness (px) — 0 removes that side's border entirely (used by morph auto-fit to drop the border on a seam between two touching blocks, on top of the -1 spacing/0 radius there)."
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "autoFit": {
            "type": "boolean"
          }
        },
        "additionalProperties": false,
        "description": "A block's per-state appearance. With autoFit on (the default for a new block), any side touching another block of this SAME widget is computed automatically (spacing -1, radius 0, border 0 on that side — see effectiveBlockAppearance in shared/morph.ts) and its fields here are ignored/disabled in the UI; a side with no neighbor always falls back to the manual value here regardless of autoFit. With autoFit off, every side is manual, same as a plain button's state. Color fields are unrelated to autoFit — always either an explicit per-block override or inherited from the widget's own state (see ColorAppearance above); nothing stops two blocks of the same widget from ending up different colors if you set them that way yourself."
      },
      "BarGaugeWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "gauge-bar"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "valueExpr": {
            "type": "string",
            "description": "JS function body (see resolveNumericExpr in shared/expr.ts), `variables` in scope, must return a number — any other outcome (throw, wrong type, NaN/Infinity) falls back to `min`."
          },
          "min": {
            "type": "number"
          },
          "max": {
            "type": "number"
          },
          "orientation": {
            "type": "string",
            "enum": [
              "horizontal",
              "vertical"
            ]
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "backgroundColor": {
            "type": "string",
            "description": "The whole widget's own backing fill, behind track/fill alike. Unset (the default) is fully transparent, same \"skip withOpacity entirely rather than resolve a literal 'transparent'\" convention as WidgetLabel's own backgroundColor in labels.tsx."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "radiusTopLeft": {
            "type": "number",
            "description": "A rectangle has corners/sides to round/border, same as BoxAppearance's own radius/border fields, so the properties panel can reuse CornersInputGrid/SidesInputGrid as-is."
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number"
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "valueExpr",
          "min",
          "max",
          "fill",
          "track",
          "labels"
        ],
        "additionalProperties": false
      },
      "ColorAppearance": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string",
            "description": "When set, evaluated (see resolveColor in shared/expr.ts) with `states` in scope and used instead of `color` — a JS expression instead of a fixed value, e.g. to derive this look from a Variable's current value."
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string",
            "description": "Same idea as colorExpr, but for borderColor (see resolveBorderColor in shared/expr.ts). Independent of colorExpr — a widget can have a static background with an expression-driven border, or vice versa."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          }
        },
        "additionalProperties": false,
        "description": "Fill/border color+opacity, shared by a widget's own per-state look and a morph block's per-state override (see MorphBlockStateOverride below) — a block's override falls back to the widget's own state fields wherever it's unset (see effectiveBlockColor in shared/morph.ts), so by default every block matches the widget and only diverges where you explicitly override it."
      },
      "ArcGaugeWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "gauge-arc"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "valueExpr": {
            "type": "string",
            "description": "JS function body (see resolveNumericExpr in shared/expr.ts), `variables` in scope, must return a number — any other outcome (throw, wrong type, NaN/Infinity) falls back to `min`."
          },
          "min": {
            "type": "number"
          },
          "max": {
            "type": "number"
          },
          "startAngle": {
            "type": "number"
          },
          "endAngle": {
            "type": "number"
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "backgroundColor": {
            "type": "string",
            "description": "The whole widget's own backing fill, behind track/fill/ticks/indicator alike. Unset (the default) is fully transparent, same \"skip withOpacity entirely rather than resolve a literal 'transparent'\" convention as WidgetLabel.backgroundColor in labels.tsx."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "tickSets": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/GaugeTickSet"
            },
            "description": "When the sweep is less than a full circle, the arc's own bounding box (not the full circle it's a slice of) is fit to the widget's box — see arcBoundsUnit in arcPath.ts — so e.g. a single quarter-circle sweep fills the whole widget instead of sitting tiny in one corner of a viewBox sized for the full circle, with the true center landing wherever that bounding box puts it (the opposite corner from the missing sweep). Tick marks/labels are deliberately excluded from that fit — they're allowed to extend past the widget's own edges rather than shrinking the arc further to make room for them."
          },
          "showIndicator": {
            "type": "boolean",
            "description": "A needle pointing at the current value, drawn with the same needlePoints math DialSwitchWidget's own needle uses. Off by default (the arc fill already shows the value), so an existing dashboard's gauge renders unchanged until this is deliberately turned on."
          },
          "showIndicatorExpr": {
            "type": "string",
            "description": "Overrides showIndicator when set — same convention as WidgetVisibility.visibleExpr/ToggleSwitchWidget.guardOpenExpr (see resolveBooleanExpr in shared/expr.ts): any truthy/falsy result works, not just a literal true/false."
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "needle",
              "square"
            ],
            "description": "'needle' (default) is the same tapered pointer DialSwitchWidget uses; 'square' is a plain radial bar instead."
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorStartDistance": {
            "type": "number",
            "description": "Where the needle/square's own drawn shape starts/ends, as distances from the gauge's true center — NOT necessarily starting at center, so e.g. a needle can float as a short segment out near the arc instead of always running from the pivot. Defaults: start 0, end ~70% of the arc radius (today's old fixed indicatorLength, unchanged in effect)."
          },
          "indicatorEndDistance": {
            "type": "number"
          },
          "indicatorWidth": {
            "type": "number",
            "description": "Half-width — the needle/square's own thickness, perpendicular to its radial direction."
          },
          "indicatorCenterSize": {
            "type": "number",
            "description": "The hub the needle/square appears to pivot from — always drawn at the true center (distance 0) regardless of indicatorStartDistance, and independent of the needle/square's own color/border. Size 0 draws none."
          },
          "indicatorCenterColor": {
            "type": "string",
            "description": "Defaults to indicatorColor (so an untouched hub reads as part of the needle rather than a separately-colored overlay) — deliberately never fill/track, same reasoning as indicatorColor itself."
          },
          "indicatorCenterBorderColor": {
            "type": "string"
          },
          "indicatorCenterBorderWidth": {
            "type": "number"
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "valueExpr",
          "min",
          "max",
          "fill",
          "track",
          "labels"
        ],
        "additionalProperties": false
      },
      "GaugeTickSet": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "count": {
            "type": "number",
            "description": "How many ticks span min..max inclusive — 2 draws exactly one at each end; anything higher adds evenly-spaced ticks between them. Default 5."
          },
          "color": {
            "type": "string"
          },
          "opacity": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderWidth": {
            "type": "number"
          },
          "size": {
            "type": "number",
            "description": "Each tick's radial length, in the same 0-100 viewBox units as GaugeWidget's own arc radius. Default 6."
          },
          "thickness": {
            "type": "number",
            "description": "Each tick's thickness along the arc (not radially). Default 2."
          },
          "distance": {
            "type": "number",
            "description": "Distance from the gauge's true center to a tick's INNER edge. Unset defaults to just outside the arc's own stroke."
          },
          "showLabels": {
            "type": "boolean"
          },
          "labelColor": {
            "type": "string"
          },
          "labelFontFamily": {
            "type": "string"
          },
          "labelFontSize": {
            "type": "number"
          },
          "labelDecimals": {
            "type": "number",
            "description": "Decimal places shown on each tick's auto-generated value label. Default 0."
          },
          "labelMin": {
            "type": "number",
            "description": "Overrides the widget's own min/max for JUST this tick set's auto-computed label values — the ticks themselves still sit at evenly-spaced angles across the widget's own startAngle..endAngle sweep regardless (see renderTickSet in widgets/tickSet.tsx); only what number each one prints changes. Useful for e.g. a compass-style ring labeled 0-360 on a widget whose real bound value only ever spans 0-1, or relabeling one tick set in different units than another on the same widget. Either unset (independently) falls back to the widget's own min/max, same as before these existed."
          },
          "labelMax": {
            "type": "number"
          },
          "labelDistance": {
            "type": "number",
            "description": "Extra distance from a tick's own outer edge to its label — same \"distance past the anchor point\" convention as WidgetLabel.labelDistance elsewhere."
          },
          "labelTextExpr": {
            "type": "string",
            "description": "JS function body, `variables` in scope same as any other bindable expression here — plus this one tick's own already-computed value, exposed as `variables.$value` (and its index within the set as `variables.$index`), same convention as evaluateMappingExpression's own $value/$index. Unset (the default) shows labelDecimals-formatted `value.toFixed(...)`, same as before this existed — set this to transform/relabel it instead, e.g. units, a lookup table for named positions, rounding to a different step than labelDecimals allows. Wired through as this tick's own WidgetLabel.textExpr (see renderTickSet in widgets/tickSet.tsx), so it reuses that field's own resolution (resolveLabelText) rather than a separate mechanism."
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false,
        "description": "Passive value display — a filled bar or arc showing valueExpr's result against min/max. No action: nothing to trigger, so it's never clickable on the client. One ring of evenly-spaced tick marks around an arc-style GaugeWidget's sweep, each optionally labeled with its own auto-computed value — e.g. a speedometer's major (numbered) and minor (unnumbered) ticks, each its own independent GaugeTickSet so they can be sized/colored/spaced completely differently. Multiple sets are addable/removable in the properties panel (see GaugeWidget.tickSets), same list convention as SwitchPosition arrays elsewhere. Rendered the same way DialSwitchWidget's own 'tick' detent shape is (a small rect, rotated to point radially — see DETENT_SIZE in DialShapeGraphic.tsx), so a tick set's color/border/size read the same as everywhere else a \"tick\" appears in this app."
      },
      "AdjusterSliderWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "adjuster-slider"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "orientation": {
            "type": "string",
            "enum": [
              "horizontal",
              "vertical"
            ]
          },
          "min": {
            "type": "number"
          },
          "max": {
            "type": "number"
          },
          "valueExpr": {
            "type": "string",
            "description": "Rest-position fallback for the handle while not being dragged (e.g. reflect a variable back into the visual) — same mechanism as Gauge's valueExpr. Falls back to `min` if unset/unresolved."
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "move": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "doublePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "triplePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "move",
              "doublePress",
              "triplePress"
            ],
            "additionalProperties": false,
            "description": "Same press/release model as ButtonWidget, plus 'move' — fires continuously (throttled) while dragging, with the live position exposed as `variables.$value` same as press/release get for their own moment (initial touch position for press, final settled position for release). doublePress/triplePress follow the exact same optIN-by-being-non-empty convention as ButtonWidget.events' own (see its comment) — arbitrating the initial touch-down doesn't affect the continuous 'move' stream or 'release' at all, only whether that first touch reports itself as press/doublePress/triplePress."
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "handleShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "none"
            ],
            "description": "The little draggable handle. 'none' hides it entirely (e.g. a board that wants just the fill level to read as position, no separate knob). handleColor unset falls back to `fill`'s own resolved color (what every existing dashboard already looks like), and handleBorderColor unset means no visible border (0 width/transparent, same \"always present, defaults to invisible\" convention as innerBezelBorderColor on the knob variant) — so a dashboard saved before these fields existed renders completely unchanged."
          },
          "handleSize": {
            "type": "number",
            "description": "Diameter for a circle handle. For a square one, handleWidth/handleHeight take priority when set (independent dimensions instead of one forced square) — each still falls back to this so an existing square handle saved before these existed renders unchanged."
          },
          "handleWidth": {
            "type": "number"
          },
          "handleHeight": {
            "type": "number"
          },
          "handleRadius": {
            "type": "number",
            "description": "Square-handle-only (a circle has no corners to round) — unset stays the sharp corners a square handle always had before this existed."
          },
          "handleColor": {
            "type": "string"
          },
          "handleOpacity": {
            "type": "number"
          },
          "handleBorderColor": {
            "type": "string"
          },
          "handleBorderWidth": {
            "type": "number"
          },
          "handleBorderOpacity": {
            "type": "number"
          },
          "radiusTopLeft": {
            "type": "number",
            "description": "A rectangle has corners/sides to round/border, same as BoxAppearance's own radius/border fields."
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number"
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the WHOLE widget in place around its own center — degrees, clockwise, 0 is unrotated — same convention as ButtonWidget's own rotateAngle, and deliberately the same \"everything rotates together\" choice that one makes rather than RockerSwitchWidget/DialSwitchWidget's own (which keep their widget-level `labels` upright as a legend/title): this widget's own `labels` above are rendered inside the same rotated element, so there's no separate always-upright layer to carve out here."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "min",
          "max",
          "events",
          "fill",
          "track",
          "labels"
        ],
        "additionalProperties": false,
        "description": "A drag-to-set-a-value control — a slider (linear drag) or knob (rotary drag). Reuses the exact same WidgetAction kinds/editor as ButtonWidget (keypress/update-state/send-dcs-command are all equally available — nothing here is specific to any one plugin), just with the live drag position additionally exposed as `variables.$value` while dragging (see evaluateMappingExpression in shared/expr.ts, the same convention an PluginMapping's own `expr` already uses) for whichever expression field the chosen action kind reads."
      },
      "AdjusterKnobWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ],
            "description": "What draws the dial's position indicator. 'needle' (the default) is a line from center to the active angle, same as always. 'square'/'circle' instead draw that shape at the dial's center plus a small indicator marker (see indicatorShape/indicatorStyle) at the active angle — on the shape's own top edge for 'square' (it's already rotated to point there), on the shape's rim for 'circle' (which isn't rotated, so the marker itself moves to the active angle instead). 'none' draws nothing at all — no shape, no indicator marker either (there's no shape left for one to sit on/point from) — for a widget whose position already reads clearly some other way, e.g. AdjusterWidget's knob, where the arc fill itself already shows the value, so a needle on top of it can be redundant."
          },
          "dialDistance": {
            "type": "number",
            "description": "Distance from the widget's true center to the dial shape's OWN center (the square/circle knob graphic, not just its indicator marker), along the same rotating axis as the active angle — same polarToCartesian technique as indicatorDistance below, just centered on the shape itself. Unlike every other distance/size field here, this one is deliberately NOT clamped to >= 0 anywhere it's wired up: a negative value is valid and flips the shape to the opposite side of center. Unset/0 is today's behavior (the shape stays centered). 'needle' dialShape ignores this — it has its own fixed length, not a center-offsettable body."
          },
          "squareWidth": {
            "type": "number",
            "description": "'square' dialShape only."
          },
          "squareHeight": {
            "type": "number"
          },
          "squareBorderWidth": {
            "type": "number"
          },
          "squareBorderRadius": {
            "type": "number"
          },
          "squareColor": {
            "type": "string"
          },
          "squareBorderColor": {
            "type": "string"
          },
          "circleSize": {
            "type": "number",
            "description": "'circle' dialShape only."
          },
          "circleBorderWidth": {
            "type": "number"
          },
          "circleColor": {
            "type": "string"
          },
          "circleBorderColor": {
            "type": "string"
          },
          "circleIndentCount": {
            "type": "number",
            "description": "'circle' dialShape only — half-circle notches bitten into the knob's rim, evenly spaced starting at the active indicator angle (so they rotate along with it) rather than at a fixed angle. Unset/0 draws none."
          },
          "circleIndentSize": {
            "type": "number",
            "description": "Radius, in the same 0-100 viewBox units as circleSize, of each notch."
          },
          "circleIndentColor": {
            "type": "string",
            "description": "Defaults to the dial face/track color, so a notch reads as the face showing through a bite taken out of the knob rather than a flat dot — but is a real, independently-settable color/opacity pair, not forced to track: pick any color to make the notch read as its own mark instead."
          },
          "circleIndentOpacity": {
            "type": "number",
            "description": "Opacity for circleIndentColor. Unset defaults to fully opaque (1) — lower it to let the knob color show through the notch instead of a flat fill, e.g. a soft shadow-like bite rather than a hard-edged one."
          },
          "circleIndentDistance": {
            "type": "number",
            "description": "Distance from the (possibly dialDistance-offset) shape's own center to each indent, same 0-100 viewBox convention as indicatorDistance. Unset defaults to circleSize/2 (the knob's own rim) — where indents sat before this became configurable."
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ],
            "description": "Reuses the same shape vocabulary/renderer as indicatorShape (see DetentIndicatorShape) instead of an indent always being a plain circle. Unset defaults to 'circle' — today's only look."
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ],
            "description": "The small marker on the dial's own shape (square/circle dialShape only) that shows the active angle — same shape/style vocabulary as a DialSwitchWidget ring detent, just a second independent instance of it since the two markers usually look different in practice. Border color lives in indicatorStyle.borderColor (DetentStyle), same as a ring detent's — deliberately no separate indicatorBorderColor field, so there's exactly one place that sets what the render actually reads. 'none' draws no indicator marker at all — just the bare square/circle knob, e.g. when a dial's own rotation already reads clearly enough without one."
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number",
            "description": "Distance from the dial's center to the indicator marker, in the same 0-100 viewBox units as everything else here. Unset defaults to the shape's own edge (squareHeight/2 for 'square', circleSize/2 for 'circle') — where the marker sat before this became configurable."
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle",
            "description": "'square' indicatorShape only — per-side border width / per-corner border radius, overriding indicatorStyle.borderWidth/borderRadius's scalar values field-by-field where set. indicatorStyle.borderColor still applies (one color for all sides, matching Dropdown's own border pattern, which also keeps color as a single field alongside per-side width/radius)."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "adjuster-knob"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "startAngle": {
            "type": "number"
          },
          "endAngle": {
            "type": "number"
          },
          "min": {
            "type": "number"
          },
          "max": {
            "type": "number"
          },
          "valueExpr": {
            "type": "string",
            "description": "Rest-position fallback for the handle while not being dragged (e.g. reflect a variable back into the visual) — same mechanism as Gauge's valueExpr. Falls back to `min` if unset/unresolved."
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "move": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "doublePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "triplePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "move",
              "doublePress",
              "triplePress"
            ],
            "additionalProperties": false,
            "description": "Same press/release model as ButtonWidget, plus 'move' — fires continuously (throttled) while dragging, with the live position exposed as `variables.$value` same as press/release get for their own moment (initial touch position for press, final settled position for release). doublePress/triplePress follow the exact same optIN-by-being-non-empty convention as ButtonWidget.events' own (see its comment) — arbitrating the initial touch-down doesn't affect the continuous 'move' stream or 'release' at all, only whether that first touch reports itself as press/doublePress/triplePress."
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "borderColor": {
            "type": "string",
            "description": "A knob has no rectangular box of its own to round/border, but DOES have its own circular face (bezelRadius etc. below) — border reuses these fields rather than adding a separate one, since a knob has no rectangular box border of its own to conflict with them (they're otherwise Slider-only on that variant)."
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "bezelRadius": {
            "type": "number",
            "description": "The dial FACE circle behind the arc/indicator, since this widget (unlike EncoderWidget/DialSwitchWidget, which always draw one) previously had none at all — just the arc floating on the widget's own transparent background. Border reuses `borderColor` above rather than adding a separate field for it — see that field's own comment; only the circle's own border WIDTH needs a dedicated field, since a circle has no separate sides. bezelColor unset falls back to `track`'s own color (so an existing dashboard's knob doesn't suddenly grow a differently- colored circle behind the arc) but stays independently overridable/ opaque via bezelColor/bezelOpacity, unlike border which always shares borderColor outright. Default radius sits comfortably inside the arc's own inner edge (see AdjusterWidget.tsx) so it reads as a face the arc rings around, not something the arc's own stroke overlaps."
          },
          "bezelColor": {
            "type": "string"
          },
          "bezelOpacity": {
            "type": "number"
          },
          "bezelBorderWidth": {
            "type": "number"
          },
          "innerBezelRadius": {
            "type": "number",
            "description": "A second, concentric circle drawn on top of the bezel above — same \"always present but defaults to radius 0 (invisible)\" convention as ToggleSwitchWidget's own innerBezelRadius, so an existing dashboard saved before this field existed doesn't suddenly grow a visible ring."
          },
          "innerBezelColor": {
            "type": "string"
          },
          "innerBezelOpacity": {
            "type": "number"
          },
          "innerBezelBorderColor": {
            "type": "string"
          },
          "innerBezelBorderWidth": {
            "type": "number"
          },
          "tickSets": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/GaugeTickSet"
            },
            "description": "Same shared shape/marks-plus-labels vocabulary as GaugeWidget's own tickSets, since a knob has the same bounded startAngle..endAngle/ min..max range an arc gauge does (unlike EncoderWidget's own EncoderTickSet, which is label-less because that widget has no such range). See renderTickSet in widgets/tickSet.tsx."
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the WHOLE widget in place around its own center — degrees, clockwise, 0 is unrotated — same convention as ButtonWidget's own rotateAngle, and deliberately the same \"everything rotates together\" choice that one makes rather than RockerSwitchWidget/DialSwitchWidget's own (which keep their widget-level `labels` upright as a legend/title): this widget's own `labels` above are rendered inside the same rotated element, so there's no separate always-upright layer to carve out here."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "min",
          "max",
          "events",
          "fill",
          "track",
          "labels"
        ],
        "additionalProperties": false
      },
      "DetentStyle": {
        "type": "object",
        "properties": {
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          },
          "borderWidth": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderRadius": {
            "type": "number"
          }
        },
        "additionalProperties": false,
        "description": "Shared shape geometry for a small marker — either one of a DialSwitchWidget's ring detents, or its dial-center indicator dot. Deliberately excludes fill color (per-position for ring detents, a single field for the indicator — different enough between the two callers that it stays outside this type) and the shape enum itself (each caller keeps its own `*Shape` field so an already-saved widget's detentShape survives this type existing at all)."
      },
      "SquareBorderStyle": {
        "type": "object",
        "properties": {
          "widthTop": {
            "type": "number"
          },
          "widthRight": {
            "type": "number"
          },
          "widthBottom": {
            "type": "number"
          },
          "widthLeft": {
            "type": "number"
          },
          "radiusTopLeft": {
            "type": "number"
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          }
        },
        "additionalProperties": false,
        "description": "Independent per-side border width / per-corner border radius for a square-shaped indicator — same box-model shape as the per-side fields Dropdown/RockerSwitch widgets already use (see SidesInputGrid/ CornersInputGrid in PropertiesPanel.tsx). Only meaningful when the field it's attached to (indicatorSquareBorder) is present AND that indicator's shape is 'square' — an SVG <rect> can't express per-side stroke-width or per-corner radius on its own, so a 'square' indicator renders as a plain HTML div using real CSS border-*-width/border-radius instead, which is what this type's fields map onto directly. Any side/corner left unset falls back to the owning DetentStyle's own scalar borderWidth/borderRadius (and ultimately to DetentShapeEditor's per-shape default), so leaving this entirely unset looks identical to the old single-scalar behavior."
      },
      "EncoderWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ],
            "description": "What draws the dial's position indicator. 'needle' (the default) is a line from center to the active angle, same as always. 'square'/'circle' instead draw that shape at the dial's center plus a small indicator marker (see indicatorShape/indicatorStyle) at the active angle — on the shape's own top edge for 'square' (it's already rotated to point there), on the shape's rim for 'circle' (which isn't rotated, so the marker itself moves to the active angle instead). 'none' draws nothing at all — no shape, no indicator marker either (there's no shape left for one to sit on/point from) — for a widget whose position already reads clearly some other way, e.g. AdjusterWidget's knob, where the arc fill itself already shows the value, so a needle on top of it can be redundant."
          },
          "dialDistance": {
            "type": "number",
            "description": "Distance from the widget's true center to the dial shape's OWN center (the square/circle knob graphic, not just its indicator marker), along the same rotating axis as the active angle — same polarToCartesian technique as indicatorDistance below, just centered on the shape itself. Unlike every other distance/size field here, this one is deliberately NOT clamped to >= 0 anywhere it's wired up: a negative value is valid and flips the shape to the opposite side of center. Unset/0 is today's behavior (the shape stays centered). 'needle' dialShape ignores this — it has its own fixed length, not a center-offsettable body."
          },
          "squareWidth": {
            "type": "number",
            "description": "'square' dialShape only."
          },
          "squareHeight": {
            "type": "number"
          },
          "squareBorderWidth": {
            "type": "number"
          },
          "squareBorderRadius": {
            "type": "number"
          },
          "squareColor": {
            "type": "string"
          },
          "squareBorderColor": {
            "type": "string"
          },
          "circleSize": {
            "type": "number",
            "description": "'circle' dialShape only."
          },
          "circleBorderWidth": {
            "type": "number"
          },
          "circleColor": {
            "type": "string"
          },
          "circleBorderColor": {
            "type": "string"
          },
          "circleIndentCount": {
            "type": "number",
            "description": "'circle' dialShape only — half-circle notches bitten into the knob's rim, evenly spaced starting at the active indicator angle (so they rotate along with it) rather than at a fixed angle. Unset/0 draws none."
          },
          "circleIndentSize": {
            "type": "number",
            "description": "Radius, in the same 0-100 viewBox units as circleSize, of each notch."
          },
          "circleIndentColor": {
            "type": "string",
            "description": "Defaults to the dial face/track color, so a notch reads as the face showing through a bite taken out of the knob rather than a flat dot — but is a real, independently-settable color/opacity pair, not forced to track: pick any color to make the notch read as its own mark instead."
          },
          "circleIndentOpacity": {
            "type": "number",
            "description": "Opacity for circleIndentColor. Unset defaults to fully opaque (1) — lower it to let the knob color show through the notch instead of a flat fill, e.g. a soft shadow-like bite rather than a hard-edged one."
          },
          "circleIndentDistance": {
            "type": "number",
            "description": "Distance from the (possibly dialDistance-offset) shape's own center to each indent, same 0-100 viewBox convention as indicatorDistance. Unset defaults to circleSize/2 (the knob's own rim) — where indents sat before this became configurable."
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ],
            "description": "Reuses the same shape vocabulary/renderer as indicatorShape (see DetentIndicatorShape) instead of an indent always being a plain circle. Unset defaults to 'circle' — today's only look."
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ],
            "description": "The small marker on the dial's own shape (square/circle dialShape only) that shows the active angle — same shape/style vocabulary as a DialSwitchWidget ring detent, just a second independent instance of it since the two markers usually look different in practice. Border color lives in indicatorStyle.borderColor (DetentStyle), same as a ring detent's — deliberately no separate indicatorBorderColor field, so there's exactly one place that sets what the render actually reads. 'none' draws no indicator marker at all — just the bare square/circle knob, e.g. when a dial's own rotation already reads clearly enough without one."
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number",
            "description": "Distance from the dial's center to the indicator marker, in the same 0-100 viewBox units as everything else here. Unset defaults to the shape's own edge (squareHeight/2 for 'square', circleSize/2 for 'circle') — where the marker sat before this became configurable."
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle",
            "description": "'square' indicatorShape only — per-side border width / per-corner border radius, overriding indicatorStyle.borderWidth/borderRadius's scalar values field-by-field where set. indicatorStyle.borderColor still applies (one color for all sides, matching Dropdown's own border pattern, which also keeps color as a single field alongside per-side width/radius)."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "encoder"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "stepDegrees": {
            "type": "number",
            "description": "Degrees of accumulated drag rotation that fire one increment/decrement step — smaller is more sensitive. Default 15 (see useEncoderDrag.ts)."
          },
          "valueExpr": {
            "type": "string",
            "description": "Rest-position fallback for the grip marker while not being dragged — same mechanism as AdjusterWidget's own valueExpr, just returning degrees (0 = up, clockwise) instead of a min..max value, since this widget has no fixed range of its own. Typical use: pair with an increment/decrement action that nudges a Variable by stepDegrees, so the grip visually tracks it. Falls back to 0 if unset/unresolved."
          },
          "events": {
            "type": "object",
            "properties": {
              "increment": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "decrement": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "doublePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "triplePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "increment",
              "decrement",
              "press",
              "release",
              "doublePress",
              "triplePress"
            ],
            "additionalProperties": false,
            "description": "doublePress/triplePress follow the exact same optIN-by-being-non-empty convention as ButtonWidget.events' own (see its comment) — arbitrating the initial touch-down doesn't affect increment/decrement or 'release' at all, only whether that first touch reports itself as press/ doublePress/triplePress."
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance",
            "description": "Grip color (used by every dialShape: the needle itself, or the square/ circle knob's own color fallback — see DialShapeStyle's squareColor/ circleColor, which each fall back to this when unset)."
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "tickSets": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/EncoderTickSet"
            }
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "events",
          "fill",
          "track",
          "labels"
        ],
        "additionalProperties": false
      },
      "EncoderTickSet": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "count": {
            "type": "number",
            "description": "How many ticks span the full 360° — evenly spaced at 360/count degrees apart, starting from 0 (up). Unlike GaugeTickSet.count (which draws one tick at EACH end of a bounded sweep, so count itself is one-less-than- the-number-of-gaps), a full circle wraps: a tick at 0° and one at 360° would be the same physical point, so count here already covers the entire lap on its own. Default 12."
          },
          "color": {
            "type": "string"
          },
          "opacity": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderWidth": {
            "type": "number"
          },
          "size": {
            "type": "number",
            "description": "Each tick's radial length, in the same 0-100 viewBox units as EncoderWidget's own dial radius. Default 6."
          },
          "thickness": {
            "type": "number",
            "description": "Each tick's thickness along the ring (not radially). Default 2."
          },
          "distance": {
            "type": "number",
            "description": "Distance from the dial's true center to a tick's INNER edge. Unset defaults to just outside the dial face's own stroke."
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false,
        "description": "A relative rotary control for DCS-BIOS's `fixed_step` interface (INC/DEC) — radio frequency knobs, altimeter pressure, radar range/gain, and any other control with no fixed endpoint. Unlike AdjusterWidget, this owns no absolute position: dragging in a circular motion (see useEncoderDrag.ts) accumulates rotation and fires `increment`/`decrement` once per `stepDegrees` crossed, exactly mirroring how a real encoder just reports \"turned one detent\" rather than \"now at X.\" A tap that never crosses the threshold instead fires `press`/`release` — many real encoders (CDU data knob, HSI course knob) are also push-buttons. One ring of evenly-spaced tick marks around an EncoderWidget's own dial — decorative only, no labels: unlike GaugeTickSet (which this is deliberately a trimmed-down sibling of), an encoder has no bounded min..max/ startAngle..endAngle range to interpolate a value or a sweep from, just a free-spinning 360° grip (see EncoderWidget.stepDegrees) — so there's nothing for a label to display, and no natural sweep to distribute count evenly across other than the full circle. Rendered the same tick-mark way GaugeTickSet's own marks are (see encoderTicks in EncoderWidget.tsx) so a tick's color/border/size read the same as everywhere else a \"tick\" appears in this app. Multiple sets are addable/removable in the properties panel, same convention as GaugeWidget.tickSets."
      },
      "RockerSwitchWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "positions": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SwitchPosition"
            }
          },
          "activePositionExpr": {
            "type": "string"
          },
          "zIndex": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "switch-rocker"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "orientation": {
            "type": "string",
            "enum": [
              "horizontal",
              "vertical"
            ]
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "positionChange": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "positionChange"
            ],
            "additionalProperties": false,
            "description": "Root-level, alongside (not instead of) each position's own onSelect — see SwitchPosition.onSelect's own comment. `press`/`release` fire on every physical press/release of the widget regardless of which segment (if any) it lands on, same press/release convention EventfulWidget types use. `positionChange` fires whenever ANY position is selected, in addition to that position's own onSelect running — with variables.$value/$index (that position's name/index — see TriggerValue in main/index.ts) in scope, so one shared sequence can still tell which position actually fired it, e.g. for a DCS command whose argument depends on which position was picked, without copy-pasting that sequence into every position."
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            },
            "description": "Labels anchored to the widget as a whole (e.g. a switch name/legend), independent of each position's own labels (SwitchPosition.labels) — same flat-list convention as Gauge/Adjuster/Encoder/Toggle/Dial's own `labels`. Deliberately NOT rotated by rotateAngle below — see its own comment — while a position's own labels (rendered inside the rotated body) do rotate with it."
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the rocker's own body — shape, segments, AND each position's own labels — in place around the widget's center; degrees, clockwise, 0 is unrotated. This widget-level `labels` array above is rendered OUTSIDE that rotated body on purpose, so a legend/title stays upright regardless of how the switch itself is tilted."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "settleToInactive": {
            "type": "boolean",
            "description": "Off (default): matches every other switch widget — the client defaults to position 0 active until something's actually tapped, then keeps whichever position was last tapped highlighted (see useSwitchPosition.ts). On: there's no default-active position at all (nothing highlighted until a tap, or activePositionExpr resolves one), AND a tap's own highlight doesn't stick — it reverts to nothing active right after, like a self-centering/momentary rocker with no resting \"on\" look. Either way, tapping a position always fires its onSelect — this only ever affects which segment (if any) LOOKS active, never whether a tap triggers."
          },
          "onInactive": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            },
            "description": "Only meaningful (shown in the properties panel, reachable at all) while settleToInactive is on — the pseudo-position's own action. A real position's own onSelect fires on press (see RockerSwitchWidgetContent's onSelect); this one fires on release instead (see its onRelease/ useSwitchPosition.ts's settleInactive), matching when the switch actually settles back to nothing active. Same \"runs alongside positionChange\" convention as a real SwitchPosition.onSelect. Not a SwitchPosition itself since there's nothing to it to style or delete — no color, no label, no id of its own — variables.$value/$index are the fixed string 'Inactive'/-1 (see TriggerValue's own comment in main/index.ts) rather than a real positions[] entry's name/index."
          },
          "radiusTopLeft": {
            "type": "number"
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number"
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          }
        },
        "required": [
          "events",
          "h",
          "id",
          "labels",
          "onInactive",
          "positions",
          "track",
          "type",
          "w",
          "x",
          "y"
        ],
        "additionalProperties": false,
        "description": "A segmented rocker/toggle switch — gear lever, master arm, band switch. Positions render as adjoining segments stacked along `orientation`."
      },
      "SwitchPosition": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string",
            "description": "When set, evaluated (see resolveColor in shared/expr.ts) with `states` in scope and used instead of `color` — a JS expression instead of a fixed value, e.g. to derive this look from a Variable's current value."
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string",
            "description": "Same idea as colorExpr, but for borderColor (see resolveBorderColor in shared/expr.ts). Independent of colorExpr — a widget can have a static background with an expression-driven border, or vice versa."
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "onSelect": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            },
            "description": "Runs once, server-side, when this position is tapped (see triggerAction's switch branch in main/index.ts) — same SequenceStep[] mechanism as a button's press/release, just keyed by position instead of by event kind."
          },
          "activeColor": {
            "type": "string",
            "description": "This position's look while it's the active one — `color`/`colorExpr` above are the unselected/idle look. Both unset (the default) means \"Auto\": derived by lightening the resolved unselected color by AUTO_CLICKED_LIGHTEN, same treatment ButtonWidget's auto-derived \"Clicked\" state gets (see pickAutoActiveColor in shared/color.ts) — computed at render time, not stored, so it always tracks a live/ expression-driven base color instead of going stale."
          },
          "activeColorExpr": {
            "type": "string"
          },
          "activeOpacity": {
            "type": "number",
            "description": "Independent of the unselected color's own backgroundOpacity — same \"each distinct color field gets its own opacity\" convention every other color pair in this app follows (e.g. background vs border)."
          },
          "momentary": {
            "type": "boolean",
            "description": "ToggleSwitchWidget only — Rocker/Dial/Dropdown leave this unused, same as they leave DetentStyle's dial-only fields unused elsewhere. Only meaningful on a toggle's first/last position (never its middle one, which has no momentary config at all — see the properties panel's own gating): pressing/dragging to a momentary position selects it (fires onSelect) only while held, springing back (firing ITS own onSelect too) the instant you release — to the middle position on a 3-position switch, or to whichever of Top/Bottom ISN'T the momentary one on a 2-position switch (there's no middle there to catch it). The properties panel enforces at most one momentary position at a time on a 2-position switch, so that \"other one\" is always unambiguous — a 3-position switch's two ends stay independent of each other since they both spring back to the same middle regardless. See ClientToggleSwitch in ClientCanvas.tsx and useToggleSwitchDrag.ts (both via momentarySpringBackIndex in ToggleSwitchWidget.tsx)."
          }
        },
        "required": [
          "id",
          "name",
          "labels",
          "onSelect"
        ],
        "additionalProperties": false,
        "description": "One selectable position of a switch widget — its own look and its own command, since (unlike a plain button's WidgetState) each position is a real, independently-triggerable target, not just a visual variant. `id` is stable list identity for the properties panel's reorder/delete, same convention as WidgetState.id."
      },
      "DialSwitchWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ],
            "description": "What draws the dial's position indicator. 'needle' (the default) is a line from center to the active angle, same as always. 'square'/'circle' instead draw that shape at the dial's center plus a small indicator marker (see indicatorShape/indicatorStyle) at the active angle — on the shape's own top edge for 'square' (it's already rotated to point there), on the shape's rim for 'circle' (which isn't rotated, so the marker itself moves to the active angle instead). 'none' draws nothing at all — no shape, no indicator marker either (there's no shape left for one to sit on/point from) — for a widget whose position already reads clearly some other way, e.g. AdjusterWidget's knob, where the arc fill itself already shows the value, so a needle on top of it can be redundant."
          },
          "dialDistance": {
            "type": "number",
            "description": "Distance from the widget's true center to the dial shape's OWN center (the square/circle knob graphic, not just its indicator marker), along the same rotating axis as the active angle — same polarToCartesian technique as indicatorDistance below, just centered on the shape itself. Unlike every other distance/size field here, this one is deliberately NOT clamped to >= 0 anywhere it's wired up: a negative value is valid and flips the shape to the opposite side of center. Unset/0 is today's behavior (the shape stays centered). 'needle' dialShape ignores this — it has its own fixed length, not a center-offsettable body."
          },
          "squareWidth": {
            "type": "number",
            "description": "'square' dialShape only."
          },
          "squareHeight": {
            "type": "number"
          },
          "squareBorderWidth": {
            "type": "number"
          },
          "squareBorderRadius": {
            "type": "number"
          },
          "squareColor": {
            "type": "string"
          },
          "squareBorderColor": {
            "type": "string"
          },
          "circleSize": {
            "type": "number",
            "description": "'circle' dialShape only."
          },
          "circleBorderWidth": {
            "type": "number"
          },
          "circleColor": {
            "type": "string"
          },
          "circleBorderColor": {
            "type": "string"
          },
          "circleIndentCount": {
            "type": "number",
            "description": "'circle' dialShape only — half-circle notches bitten into the knob's rim, evenly spaced starting at the active indicator angle (so they rotate along with it) rather than at a fixed angle. Unset/0 draws none."
          },
          "circleIndentSize": {
            "type": "number",
            "description": "Radius, in the same 0-100 viewBox units as circleSize, of each notch."
          },
          "circleIndentColor": {
            "type": "string",
            "description": "Defaults to the dial face/track color, so a notch reads as the face showing through a bite taken out of the knob rather than a flat dot — but is a real, independently-settable color/opacity pair, not forced to track: pick any color to make the notch read as its own mark instead."
          },
          "circleIndentOpacity": {
            "type": "number",
            "description": "Opacity for circleIndentColor. Unset defaults to fully opaque (1) — lower it to let the knob color show through the notch instead of a flat fill, e.g. a soft shadow-like bite rather than a hard-edged one."
          },
          "circleIndentDistance": {
            "type": "number",
            "description": "Distance from the (possibly dialDistance-offset) shape's own center to each indent, same 0-100 viewBox convention as indicatorDistance. Unset defaults to circleSize/2 (the knob's own rim) — where indents sat before this became configurable."
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ],
            "description": "Reuses the same shape vocabulary/renderer as indicatorShape (see DetentIndicatorShape) instead of an indent always being a plain circle. Unset defaults to 'circle' — today's only look."
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ],
            "description": "The small marker on the dial's own shape (square/circle dialShape only) that shows the active angle — same shape/style vocabulary as a DialSwitchWidget ring detent, just a second independent instance of it since the two markers usually look different in practice. Border color lives in indicatorStyle.borderColor (DetentStyle), same as a ring detent's — deliberately no separate indicatorBorderColor field, so there's exactly one place that sets what the render actually reads. 'none' draws no indicator marker at all — just the bare square/circle knob, e.g. when a dial's own rotation already reads clearly enough without one."
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number",
            "description": "Distance from the dial's center to the indicator marker, in the same 0-100 viewBox units as everything else here. Unset defaults to the shape's own edge (squareHeight/2 for 'square', circleSize/2 for 'circle') — where the marker sat before this became configurable."
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle",
            "description": "'square' indicatorShape only — per-side border width / per-corner border radius, overriding indicatorStyle.borderWidth/borderRadius's scalar values field-by-field where set. indicatorStyle.borderColor still applies (one color for all sides, matching Dropdown's own border pattern, which also keeps color as a single field alongside per-side width/radius)."
          },
          "positions": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SwitchPosition"
            }
          },
          "activePositionExpr": {
            "type": "string"
          },
          "zIndex": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "switch-dial"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            },
            "description": "Labels anchored to the widget as a whole (e.g. a switch name/legend), independent of each position's own labels (SwitchPosition.labels) — same flat-list convention as Gauge/Adjuster/Encoder's own `labels`, rendered as absolutely-positioned overlays via renderWidgetLabels. Part of the same rotated group as everything else — see rotateAngle's own comment."
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the WHOLE widget — dial face, needle, every detent and its own label, AND the widget-level `labels` above — together in place around the widget's center; degrees, clockwise, 0 is unrotated. Same \"everything rotates together\" choice ButtonWidget/AdjusterWidget/ ToggleSwitchWidget make, not RockerSwitchWidget's own (which keeps its widget-level `labels` upright as a legend/title). 'drag' interactionMode's own movement math (useDialSwitchDrag.ts) counter-rotates by this same angle so the needle still tracks the pointer directly instead of at an offset — see that hook's own comment."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "positionChange": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "increment": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "decrement": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "doublePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "triplePress": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "positionChange",
              "increment",
              "decrement",
              "doublePress",
              "triplePress"
            ],
            "additionalProperties": false,
            "description": "Root-level, alongside (not instead of) each position's own onSelect — see RockerSwitchWidget.events' own comment for press/release/ positionChange. increment/decrement are DialSwitchWidget-only (the one switch type that's actually rotary) — same 'Turn CW'/'Turn CCW' vocabulary EncoderWidget already uses, fired when a selection lands on a higher/lower position index than whichever was active before it, in ADDITION to that selection's own onSelect/positionChange — see useSwitchPosition.ts. doublePress/triplePress: same optIN-by-being-non-empty convention as ButtonWidget.events' own (see its comment) — a tap is only ever held back to arbitrate single/double/triple when at least one of these two actually has steps, so a dial switch with neither configured keeps firing press the instant it's pressed, zero added latency."
          },
          "startAngle": {
            "type": "number"
          },
          "endAngle": {
            "type": "number"
          },
          "interactionMode": {
            "type": "string",
            "enum": [
              "tap",
              "drag"
            ],
            "description": "'tap' (default): tap a detent directly to select it. 'drag': press anywhere on the widget and drag in the direction of the position you want (can go past the widget's own bounds) — the needle snaps live to whichever position is nearest the drag angle so you can see what releasing would select, same as turning a real rotary switch. Both still fire the same 'select' action:trigger on commit, or live as each position is passed through — see fireWhileDragging below — and useDialSwitchDrag.ts/useSwitchPosition.ts."
          },
          "fireWhileDragging": {
            "type": "boolean",
            "description": "'drag' interactionMode only. On by default (undefined ?? true — see useDialSwitchDrag.ts and PropertiesPanel.tsx's own fallbacks, and migrateDialSwitchFireWhileDragging in main/index.ts, which backfills an explicit true onto every dial switch saved before this existed): every distinct position the drag passes through fires 'select'/positionChange (and increment/decrement, same as any other landed-on selection — see events' own comment above) live, the instant it's reached, rather than only on release. Release still fires once more for whatever position the gesture actually ends on, unless that position already fired live as the last one reached (see useDialSwitchDrag.ts's lastFiredIndexRef). Explicit false opts back out to the old release-only behavior. Same convention as ToggleSwitchWidget.fireWhileDragging — see its own comment — just without a momentary position's own always-live exception, since DialSwitchWidget's positions have no momentary concept (see SwitchPosition.momentary's own comment)."
          },
          "waitForStateConfirm": {
            "type": "boolean",
            "description": "'drag' interactionMode only. Off by default (undefined ?? false — preserves the original behavior for every dial switch saved before this existed, no migration needed). Normally the needle previews live during a drag (see dragIndex in useDialSwitchDrag.ts/DialSwitchWidgetContent) and then optimistically holds the just-picked position (see `pending` in useSwitchPosition.ts) until activePositionExpr's own live value confirms it or PENDING_CONFIRM_TIMEOUT_MS gives up — both are local predictions of where the needle SHOULD end up. With this on, neither prediction happens: the drag still fires 'select'/positionChange (and increment/decrement) exactly like fireWhileDragging already does, but the needle itself only moves once activePositionExpr's bound variable actually changes — i.e. once whatever external system owns the real position (DCS-BIOS, a REST source, ...) confirms it. Meaningless without activePositionExpr set — with no live expr there's nothing for the needle to wait on, so it'd just never move."
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "borderColor": {
            "type": "string",
            "description": "Per-label label anchor — see WidgetLabel.labelAnchor."
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "detentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ],
            "description": "How each detent dot is drawn. Unset (the default) is a plain circle; 'tick' and 'triangle' are rotated to point radially outward along that detent's own angle (same convention angleForPosition/labelAnchorPoint use), reading like a real rotary switch's click-stops. 'none' draws no detent marker at all — a position's own label (if it has one) is still tappable in 'tap' interactionMode, same as every other shape; a position with no labels becomes untappable that way and needs drag mode instead."
          },
          "detentRadius": {
            "type": "number",
            "description": "Distance from center to each detent dot, in the same 0-100 viewBox units as everything else here (see DialSwitchWidgetContent). Unset (the default) uses DETENT_RADIUS."
          },
          "detentStyle": {
            "$ref": "#/definitions/DetentStyle",
            "description": "Size/border for whichever detentShape is picked — see DetentStyle. Unset fields fall back to the fixed DETENT_SIZE/CSS defaults for that shape."
          }
        },
        "required": [
          "events",
          "fill",
          "h",
          "id",
          "labels",
          "positions",
          "track",
          "type",
          "w",
          "x",
          "y"
        ],
        "additionalProperties": false,
        "description": "A rotary dial switch — HSI/ADI mode selector, ignition/mag switch. Positions render as labeled detents around startAngle..endAngle, with a needle pointing at whichever one is active."
      },
      "ToggleSwitchWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "positions": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SwitchPosition"
            }
          },
          "activePositionExpr": {
            "type": "string"
          },
          "zIndex": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "switch-toggle"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            },
            "description": "Labels anchored to the widget as a whole (e.g. a switch name/legend), independent of each position's own labels (SwitchPosition.labels) — same flat-list convention as Gauge/Adjuster/Encoder's own `labels`, rendered as absolutely-positioned overlays via renderWidgetLabels. Part of the same rotated group as everything else below — see rotateAngle's own comment."
          },
          "rotateAngle": {
            "type": "number",
            "description": "Spins the WHOLE widget — bezel, lever, guard, every position's own labels, AND the widget-level `labels` above — together in place around the widget's center; degrees, clockwise, 0 is unrotated. Same \"everything rotates together\" choice ButtonWidget/AdjusterWidget make, not RockerSwitchWidget/DialSwitchWidget's own (which keep their widget-level `labels` upright as a legend/title). 'drag' interactionMode's own movement math (useToggleSwitchDrag.ts) counter-rotates by this same angle so the lever still tracks the pointer directly instead of at an offset — see that hook's own comment."
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "positionChange": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "guardToggle": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "positionChange",
              "guardToggle"
            ],
            "additionalProperties": false,
            "description": "Root-level, alongside (not instead of) each position's own onSelect — see RockerSwitchWidget.events' own comment for the full reasoning (same convention here). guardToggle (guardEnabled only — see its own comment below) is this widget's one addition beyond what every other switch type carries: fires whenever the guard is tapped, whether that open/closes it locally or the tap is actually overridden by guardOpenExpr — the only way to hang a real side effect (a DCS-BIOS command, an update-state) off pressing the cover itself, since guardOpenExpr only ever reads a variable, never writes one back. variables.$value (see TriggerValue) is 1 if this tap is opening the guard, 0 if closing it — see ClientToggleSwitch in ClientCanvas.tsx."
          },
          "orientation": {
            "type": "string",
            "enum": [
              "horizontal",
              "vertical"
            ]
          },
          "interactionMode": {
            "type": "string",
            "enum": [
              "tap",
              "drag"
            ],
            "description": "'tap' (default): tap a zone (or its label) to select that position directly. 'drag': press anywhere on the widget and drag toward the position you want, same gesture as DialSwitchWidget's own drag mode — see useToggleSwitchDrag.ts, which (unlike Dial's drag) also fires a momentary position's onSelect live as the drag reaches it, not just on release, since a momentary throw has nothing meaningful to \"commit\" later — see SwitchPosition.momentary."
          },
          "fireWhileDragging": {
            "type": "boolean",
            "description": "'drag' interactionMode only. On by default (undefined ?? true — see useToggleSwitchDrag.ts and PropertiesPanel.tsx's own fallbacks, and migrateToggleSwitchFireWhileDragging in main/index.ts, which backfills an explicit true onto every toggle switch saved before this existed): every distinct position the drag passes through fires 'select'/positionChange live, the instant it's reached, same \"nothing meaningful to commit later\" treatment a momentary position's onSelect already always gets (see SwitchPosition.momentary) — just opt-in here for a normal position too. Release still fires once more for whatever position the gesture actually ends on, unless that position already fired live as the last one reached (see useToggleSwitchDrag.ts's lastFiredIndexRef). Explicit false opts back out to the old release-only behavior."
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "fill": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "borderWidth": {
            "type": "number",
            "description": "The bezel's own stroke width, in the same 0-100 viewBox units as bezelRadius below. Defaults to 2 (the width it was hardcoded to before this became configurable) in ToggleSwitchWidget.tsx."
          },
          "bezelRadius": {
            "type": "number",
            "description": "The base/bezel circle's own radius, in the same 0-100 viewBox units as BEZEL_RADIUS (its default) in ToggleSwitchWidget.tsx. The label ring scales off whichever value is effective, so shrinking/growing the bezel doesn't leave labels anchored to the old rim position — leverLength below is independent and NOT clamped to this, so a lever can be sized to intentionally poke out past a shrunk bezel. Applies the same regardless of bezelShape below — a hexagon's own \"radius\" is the distance from its center to each vertex, same as a circle's."
          },
          "bezelShape": {
            "type": "string",
            "enum": [
              "circle",
              "hexagon"
            ],
            "description": "'circle' (default/unset): today's plain disc. 'hexagon': a 6-sided bolt- head-style base instead, same radius/label-ring math either way — see hexagonPoints in ToggleSwitchWidget.tsx."
          },
          "bezelRotation": {
            "type": "number",
            "description": "Hexagon only (a circle looks identical at any rotation, so this is simply ignored for 'circle') — degrees, clockwise, 0 is unrotated (one vertex pointing straight up), same convention as RockerSwitchWidget's own rotateAngle."
          },
          "innerBezelColor": {
            "type": "string",
            "description": "A second, concentric circle drawn on top of the bezel above — always present regardless of position count (unlike circleColor et al. below, which are the separate middle-position-only marker). Defaults to radius 0 (invisible) rather than a fixed fraction of bezelRadius, so an existing dashboard saved before this field existed doesn't suddenly grow a visible ring — it only appears once deliberately sized in the properties panel. Color/opacity default to `track`'s own (matching the bezel until overridden); border defaults to none. All in ToggleSwitchWidget.tsx."
          },
          "innerBezelOpacity": {
            "type": "number"
          },
          "innerBezelRadius": {
            "type": "number"
          },
          "innerBezelBorderColor": {
            "type": "string"
          },
          "innerBezelBorderWidth": {
            "type": "number"
          },
          "leverLength": {
            "type": "number",
            "description": "The lever's own length (from the pivot at the bezel's center out to its tip) and border — independent of the bezel's border above. Length defaults to LEVER_LENGTH, border to none (width 0), both in ToggleSwitchWidget.tsx."
          },
          "leverBorderColor": {
            "type": "string"
          },
          "leverBorderWidth": {
            "type": "number"
          },
          "leverTipRadius": {
            "type": "number",
            "description": "The half-width of the lever's own tip — the wide, rounded end sticking up out of the bezel (see LEVER_TIP_HALF_WIDTH, its default, in ToggleSwitchWidget.tsx). Also drives the size of the foreshortened ellipse cap drawn on top of that tip (see circleTopStyle above) and, via circleRadius's own default, the plain circle shown at an odd-count switch's middle position — same physical point of the switch in all three cases, so resizing it here keeps them in sync unless circleRadius is deliberately overridden. Previously the only way to make the tip read bigger was cranking up leverBorderWidth, which just thickens the outline rather than growing the shape itself."
          },
          "leverBaseRadius": {
            "type": "number",
            "description": "The half-width of the lever's own base — the narrow end that tapers down into the pivot, like a post through a hole (see LEVER_BASE_HALF_WIDTH, its default, in ToggleSwitchWidget.tsx). Independent of leverTipRadius above — this is the OTHER end of the taper, not the same physical point viewed differently, so it isn't shared with any circle/ellipse default the way leverTipRadius is."
          },
          "leverShape": {
            "type": "string",
            "enum": [
              "normal",
              "bar"
            ],
            "description": "'normal' (default): exactly today's look — a bare tapered lever for top/bottom, a plain circle (see circleColor etc. below) at an odd-count switch's middle position. 'bar': a configurable rectangle — barColor/ Width/Height/BorderColor/BorderWidth/BorderRadius below — capping the lever's own tip for top/bottom (drawn on top of, not instead of, the tapered post, rotating together with it), and standing in for the circle entirely at the middle position (there's no lever there to cap) — like a real toggle's paddle/bat handle mounted on its post. See ToggleSwitchWidget.tsx."
          },
          "circleColor": {
            "type": "string",
            "description": "The plain circle drawn instead of a lever at an odd-count switch's exact middle position (see isMiddlePosition) — a distinct look from the lever/ `fill` above, since a real 3-way toggle's neutral throw often reads as a different center rather than just \"the lever pointing at itself\". Color/ opacity default to `fill`'s own (so an existing dashboard's middle position keeps its prior look until deliberately overridden); size defaults to the effective leverTipRadius above (itself defaulting to LEVER_TIP_HALF_WIDTH, so an existing dashboard that's never touched either field sees no change), border to none (width 0) — all in ToggleSwitchWidget.tsx. leverShape 'bar' only (see its own comment above) — unused (but left in place, not migrated away) once 'bar' is picked."
          },
          "circleOpacity": {
            "type": "number"
          },
          "circleRadius": {
            "type": "number"
          },
          "circleBorderColor": {
            "type": "string"
          },
          "circleBorderWidth": {
            "type": "number"
          },
          "circleTopStyle": {
            "type": "string",
            "enum": [
              "flat",
              "rounded"
            ],
            "description": "Shading applied across the circle's own fill, to read as a 3D cap rather than a flat disc — 'rounded' (default/unset): a full radial highlight offset toward the upper-left, like a sphere. 'flat': a thin light rim right at the edge over an otherwise flat face, like a cylinder cap catching a line of light — the tip's own outline foreshortens into an ellipse for this style too (see leverTipDomeRy in ToggleSwitchWidget.tsx), since unlike a sphere a flat disc's silhouette isn't angle-invariant. Purely cosmetic — doesn't affect circleColor/ circleOpacity above, which still set the base color the shading is lightened/darkened from. See ToggleSwitchWidget.tsx."
          },
          "barWidth": {
            "type": "number",
            "description": "leverShape 'bar' only — see its own comment above. Width/height in the same 0-100 viewBox units as everything else here; color/opacity default to `fill`'s own, same reasoning as the circle fields above; border defaults to none (width 0); corner radius defaults to 0 (a plain rectangle) — all in ToggleSwitchWidget.tsx."
          },
          "barHeight": {
            "type": "number"
          },
          "barColor": {
            "type": "string"
          },
          "barOpacity": {
            "type": "number"
          },
          "barBorderColor": {
            "type": "string"
          },
          "barBorderWidth": {
            "type": "number"
          },
          "barBorderRadius": {
            "type": "number"
          },
          "guardEnabled": {
            "type": "boolean",
            "description": "Optional flip-up safety cover, drawn on top of everything else in ToggleSwitchWidget.tsx (bezel, lever, both label sets) — off (default/ unset) draws no guard at all, identical to every dashboard saved before this existed. Closed (the local per-client default — see ClientToggleSwitch in ClientCanvas.tsx), it's an opaque colored box that catches the tap itself instead of the switch beneath it; tapping it flips open, at which point it's rendered pointer-events:none so taps fall straight through to the switch's own zones underneath — same click-through technique MorphButtonWidget's own wrapper uses (see .client-canvas__widget--morph in styles.css). guard's own borderColor/borderColorExpr/borderOpacity (it's a ColorAppearance, same as track/fill above) cover its border color; guardBorderWidth is the one border knob ColorAppearance doesn't carry."
          },
          "guard": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "guardBorderWidth": {
            "type": "number"
          },
          "guardRadius": {
            "type": "number"
          },
          "guardWidth": {
            "type": "number",
            "description": "The guard's own size, independent of the switch's own w/h — centered over it. Unset defaults to the full widget box (matches the switch's own bounds), same \"unset = today's behavior\" convention as everything else here."
          },
          "guardHeight": {
            "type": "number"
          },
          "guardTop": {
            "type": "number",
            "description": "Distance from the widget's own top edge to the CLOSED guard's own top edge — negative allowed, so it can extend up past the widget's own bounds entirely (e.g. to clear a lever poking out from under it once it's flipped). Unset centers it vertically within the widget instead — today's behavior, unchanged (see ToggleSwitchWidget.tsx's own guardTop computation)."
          },
          "guardOpenHeight": {
            "type": "number",
            "description": "The OPEN hinge tab's own height/top — independent of guardHeight/ guardTop above, since the flipped-open tab is a differently-shaped, differently-purposed element (a small strip meant to stay grabbable without covering the reveal, not the full cover) with its own natural default: a fixed 14px strip pinned to the widget's own top edge, same as before either of these existed."
          },
          "guardOpenTop": {
            "type": "number"
          },
          "guardOpenExpr": {
            "type": "string",
            "description": "Drives open/closed from a Variable instead of local taps — same \"expression overrides local tap state\" convention as SwitchWidgetBase.activePositionExpr, e.g. tying the guard to the same variable the switch itself reports so it stays open once the switch is already thrown."
          }
        },
        "required": [
          "events",
          "fill",
          "h",
          "id",
          "labels",
          "positions",
          "track",
          "type",
          "w",
          "x",
          "y"
        ],
        "additionalProperties": false,
        "description": "A physical panel toggle — gear handle, master arm, BATT switch. A single round bezel (always a true circle, same \"SVG viewBox scales uniformly\" convention as DialSwitchWidget's dial face — see ToggleSwitchWidget.tsx's own comment) holds one lever that points between 2 or 3 throws (unlike Rocker/Dial's arbitrary N — the properties panel caps it) — straight up for the first position, straight down for the last (or left/right for 'horizontal'). Unlike RockerSwitchWidget's adjoining colored segments, only one lever is ever drawn, so per-position look lives in `fill`/`track` (fixed, not per-SwitchPosition) — a position's own `color`/`activeColor` fields (inherited from SwitchPosition) go unused here, same as DialSwitchWidget's ring detents leave DetentStyle's unrelated fields unused. With exactly 3 positions, the middle one renders as a plain circle instead of a lever pointing sideways — the \"center\" look a real 3-position toggle's neutral throw gets (e.g. a BATT switch's OFF) — see ToggleSwitchWidgetContent's isMiddlePosition. Each position's `name` is fixed by the properties panel, not freely editable, to \"Top\"/\"Bottom\" (2 positions) or \"Top\"/\"Middle\"/\"Bottom\" (3) — activePositionExpr and each position's momentary config (see SwitchPosition.momentary) both key off these names, so they can't drift from what's actually rendered where. Each position's own labels still place themselves the same way a DialSwitch detent's do — via each WidgetLabel's own labelAnchor, defaulting to 'auto' (radially outward at that position's own angle)."
      },
      "DropdownWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "positions": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SwitchPosition"
            }
          },
          "activePositionExpr": {
            "type": "string"
          },
          "zIndex": {
            "type": "number"
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "dropdown"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "orientation": {
            "type": "string",
            "enum": [
              "top-to-bottom",
              "bottom-to-top",
              "left-to-right",
              "right-to-left"
            ],
            "description": "Which axis the held-open stack fans out along, and which direction it grows in — default 'top-to-bottom'. See shared/dropdownLayout.ts for how this maps to a physical axis/sign, shared by rendering and drag resolution alike."
          },
          "expandMode": {
            "type": "string",
            "enum": [
              "anchored",
              "unanchored"
            ],
            "description": "'anchored' (default): active position stays put, others fan around it. 'unanchored': list always starts at the widget's own footprint — see above."
          },
          "events": {
            "type": "object",
            "properties": {
              "press": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "release": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              },
              "positionChange": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/SequenceStep"
                }
              }
            },
            "required": [
              "press",
              "release",
              "positionChange"
            ],
            "additionalProperties": false
          },
          "track": {
            "$ref": "#/definitions/ColorAppearance"
          },
          "radiusTopLeft": {
            "type": "number"
          },
          "radiusTopRight": {
            "type": "number"
          },
          "radiusBottomLeft": {
            "type": "number"
          },
          "radiusBottomRight": {
            "type": "number"
          },
          "borderWidthTop": {
            "type": "number"
          },
          "borderWidthRight": {
            "type": "number"
          },
          "borderWidthBottom": {
            "type": "number"
          },
          "borderWidthLeft": {
            "type": "number"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          }
        },
        "required": [
          "events",
          "h",
          "id",
          "positions",
          "track",
          "type",
          "w",
          "x",
          "y"
        ],
        "additionalProperties": false,
        "description": "A collapsed picker — CDU page selector, radio channel select. Normally shows only the active position, sized like a single cell; press and hold to reveal the rest stacked along `orientation`, in one of two layouts (see expandMode):   - 'anchored' (default): the active one stays exactly where it already     was and the others fan out around it in list order (4 positions, #2     active: #1 renders one slot above, #3/#4 one/two slots below).   - 'unanchored': the list always starts at the widget's own x/y footprint     regardless of which one is active (position 0 fills it, the rest     stack below/right of it in list order) — active is just highlighted     wherever it falls. Both drag while held to preview, release to commit — see useDropdownDrag.ts, which resolves the drag distance to a slot the same way useDialSwitchDrag.ts resolves an angle to a detent, just linear instead of angular, then maps that slot to a position index per expandMode the same way DropdownWidgetContent does for layout.\n\nDeliberately NOT an EventfulWidget or a SwitchWidget: it's both at once (own press/release, like Adjuster/Encoder, AND per-position onSelect, like the switches) — see its own dedicated branch in triggerAction rather than forcing it through either single-purpose union."
      },
      "ScreenCaptureWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "screen-capture"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "displayId": {
            "type": "number",
            "description": "Which physical display `region` was picked on (Electron's stable per-display Display.id) — drives the properties panel's monitor dropdown and re-scopes a later re-pick to the right screen. UI-only: capture itself only ever needs `region`, already in absolute virtual-desktop coordinates."
          },
          "region": {
            "$ref": "#/definitions/ScreenRegion"
          },
          "streamMode": {
            "type": "string",
            "enum": [
              "poll",
              "mjpeg"
            ],
            "description": "'poll' (default): the client re-fetches a fresh JPEG over plain HTTP on its own timer — simplest, stateless, one request per frame. 'mjpeg': a single persistent multipart/x-mixed-replace HTTP connection the server pushes frames into — smoother, and one capture loop serves every simultaneous viewer of this widget, but needs server-side connection lifecycle management. See main/screenCapture.ts."
          },
          "fps": {
            "type": "number"
          },
          "quality": {
            "type": "number"
          },
          "fit": {
            "$ref": "#/definitions/BackgroundFit",
            "description": "Reuses Dashboard's own BackgroundFit vocabulary/UI for consistency — 'tile' isn't meaningful for a live feed and is treated as 'cover'."
          },
          "brightness": {
            "type": "number",
            "description": "Cheap, always-on CSS filter() knobs — applied client-side, no capture- side cost regardless of value. Each defaults to 1 (no-op)."
          },
          "contrast": {
            "type": "number"
          },
          "saturation": {
            "type": "number"
          },
          "sharpen": {
            "type": "boolean",
            "description": "Opt-in: unlike the above, this is real per-frame CPU work on the capture side (routed through `sharp` instead of the default nativeImage JPEG encode — see main/screenCapture.ts), so it's off by default rather than always applied."
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h"
        ],
        "additionalProperties": false,
        "description": "A live view of a region of the desktop's own screen, streamed to every connected client — passive, like GaugeWidget: nothing to trigger, so it's never clickable on the client. `region` is unset until \"Pick region\" (see ScreenCaptureWidget's own properties-panel section) has been used at least once; the widget renders a placeholder until then."
      },
      "ScreenRegion": {
        "type": "object",
        "properties": {
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          }
        },
        "required": [
          "x",
          "y",
          "width",
          "height"
        ],
        "additionalProperties": false,
        "description": "Absolute virtual-desktop pixel coordinates — the same coordinate space Electron's own `display.bounds` uses, so a region picked on any monitor (see displayId below) is captured correctly without needing to also track \"relative to which display's origin.\""
      },
      "BackgroundFit": {
        "type": "string",
        "enum": [
          "cover",
          "contain",
          "stretch",
          "tile",
          "none"
        ]
      },
      "DcsViewportWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "dcs-viewport"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "componentKey": {
            "type": "string"
          },
          "cropTop": {
            "type": "number",
            "description": "Percent of the resolved component region to crop off each edge BEFORE fit/scaling — lets a widget trim DCS's own cockpit-instrument bezel (see dcsViewports/index.ts's resolveComponentRegion, which already applies a small default inset; these stack on top of that per-widget, since the exact bezel size can differ enough between components that one fixed global percentage doesn't fit all of them precisely). Negative expands back out past that default inset instead. Unset = 0."
          },
          "cropRight": {
            "type": "number"
          },
          "cropBottom": {
            "type": "number"
          },
          "cropLeft": {
            "type": "number"
          },
          "streamMode": {
            "type": "string",
            "enum": [
              "poll",
              "mjpeg"
            ]
          },
          "tapToStream": {
            "type": "boolean",
            "description": "When not explicitly false, the widget loads showing a \"tap to start streaming\" prompt instead of immediately polling/opening an mjpeg connection — lets a dashboard with many DCS Viewport widgets stay idle until the user actually wants a given one live, rather than every one of them pulling frames the moment the dashboard loads. Defaults ON (tap required); set false for the old always-streams-immediately behavior. Purely a renderer-side gate — resets on remount (dashboard reload/switch), not persisted per session."
          },
          "fps": {
            "type": "number"
          },
          "quality": {
            "type": "number"
          },
          "fit": {
            "$ref": "#/definitions/BackgroundFit"
          },
          "brightness": {
            "type": "number"
          },
          "contrast": {
            "type": "number"
          },
          "saturation": {
            "type": "number"
          },
          "sharpen": {
            "type": "boolean"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "borderWidth": {
            "type": "number"
          },
          "borderRadius": {
            "type": "number",
            "description": "Corner radius in px, applied to the border and clipping the stream image inside it. Unset = 0 (square)."
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h"
        ],
        "additionalProperties": false,
        "description": "A DCS Viewports plugin widget — reuses ScreenCaptureWidget's exact streaming pipeline (same /screen-capture/frame|stream HTTP routes, keyed by deck+widget id, see main/index.ts's resolveStreamableWidget) but with the region LOCKED: instead of a user-drawn `region`/`displayId`, the user picks a named component (e.g. \"hornet:LEFT_MFCD\") and the server resolves its rect from the live virtual display's bounds + the shared tiling function in dcsViewportsCatalog.ts — so it can never point at an arbitrary region the way ScreenCaptureWidget can. `componentKey` is `${aircraftId}:${componentId}`, unset until first chosen in Properties."
      },
      "LabelWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "label"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "label": {
            "$ref": "#/definitions/WidgetLabel"
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h",
          "label"
        ],
        "additionalProperties": false,
        "description": "The simplest widget there is — just one WidgetLabel, full-bleed over its own x/y/w/h box. Deliberately a single `label`, not the flat `labels[]` every other widget type carries alongside its own shape (a switch's legend, a gauge's title, ...) — those are ANOTHER label on top of something else already being drawn; this widget IS the label, so there's nothing for a second one to add. No events, no colors of its own (the label's own WidgetLabel.backgroundColor covers that) — see LabelWidgetContent in components/widgets/LabelWidget.tsx."
      },
      "LineWidget": {
        "type": "object",
        "properties": {
          "visible": {
            "type": "boolean"
          },
          "visibleExpr": {
            "type": "string"
          },
          "groupId": {
            "type": "string",
            "description": "Move-only grouping (see the \"Widget grouping\" feature) — widgets sharing the same groupId move together as a unit when any one of them is dragged (see useWidgetDrag.ts/store.ts's selectWidget), and select together on a fresh click. At most one groupId per widget — no nested/ overlapping groups. Every Widget union member extends this interface, so this is the one shared spot that covers all grouped-capable widget types without threading a new field through each one individually. Undefined (the default, and every dashboard saved before this existed) means \"not in a group\" — ordinary single-widget select/drag, unchanged."
          },
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "const": "line"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "w": {
            "type": "number"
          },
          "h": {
            "type": "number"
          },
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string"
          },
          "lineWidth": {
            "type": "number",
            "description": "The actual drawn thickness of the bar, vertically centered within h — deliberately separate from h so h can stay a comfortably large drag/click target (and rotation pivot box) while the visible line itself is thin. Falls back to h (i.e. the bar fills its own box, same as before this field existed) when unset."
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string",
            "description": "Overrides rotateAngle with a live expression (degrees, same convention) when set — e.g. tying the tilt to a variable instead of a fixed value. Falls back to rotateAngle if unset or unresolved."
          },
          "zIndex": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "type",
          "x",
          "y",
          "w",
          "h"
        ],
        "additionalProperties": false,
        "description": "A straight decorative bar — w is its length, h its bounding-box height (drag/select hit target, and the ceiling lineWidth can't exceed). The editor's resize handle only ever drags length (see CanvasWidget.tsx), not h — for anything but perfectly horizontal, use rotateAngle rather than fighting with a 2D resize to get an angled line, same convention as ButtonWidget/RockerSwitchWidget's own rotateAngle (degrees, clockwise, 0 unrotated). No labels/events of its own — if you need those, use a Label or Button widget instead; this is purely a visual divider/rule."
      }
    }
  },
  "Variable": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/Variable",
    "definitions": {
      "Variable": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "value": {
            "$ref": "#/definitions/VariableValue"
          }
        },
        "required": [
          "id",
          "name",
          "value"
        ],
        "additionalProperties": false,
        "description": "Named piece of shared, internal, live state — set by an update-state action, read by any widget's colorExpr/textExpr elsewhere on the dashboard via `states.<name>`. `id` is just for stable list identity in the editor (drag-reorder, delete) — expressions reference variables by `name`, so renaming one is a manual find-and-fix in whatever expressions used the old name, not something this app can track for you."
      },
      "VariableValue": {
        "type": [
          "string",
          "number",
          "boolean"
        ],
        "description": "Loosely-typed on purpose — whatever a variable's controlling widget's update-state action last returned for it (see UpdateStateAction above)."
      }
    }
  },
  "Plugin": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/Plugin",
    "definitions": {
      "Plugin": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "mappings": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/PluginMapping"
            }
          },
          "config": {
            "type": "object",
            "additionalProperties": {}
          }
        },
        "required": [
          "id",
          "kind",
          "name",
          "mappings"
        ],
        "additionalProperties": false,
        "description": "A configured, persistent instance of a plugin (e.g. \"the clock\"), continuously producing named fields and feeding a subset of them into Variables via `mappings`. `kind` is deliberately an open string rather than a union — every kind shares this exact shape (mappings + opaque config), so a union would only add friction when a new kind is added, unlike WidgetAction where each kind's payload actually differs. `config` is unused by the only kind implemented so far ('datetime') — reserved for a future kind's own settings, e.g. a webhook's path or a poller's interval. Disabling a kind entirely (see PLUGIN_TYPES/enabledPlugins) not only stops its producer but, for a kind that declares `widgetTypes` (see PluginTypeMeta), also renders every widget of those types inert."
      },
      "PluginMapping": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "field": {
            "type": "string"
          },
          "variableName": {
            "type": "string"
          },
          "expr": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "field",
          "variableName"
        ],
        "additionalProperties": false,
        "description": "One field of a plugin's output routed into a Variable. `field` is a key from that plugin kind's metadata (see PLUGIN_TYPES in shared/plugins) — the raw value for it comes from the matching main-process producer (see main/plugins/). `expr`, if set, is evaluated (see evaluateMappingExpression in shared/expr.ts) with the raw value exposed as `variables.$value`, alongside every existing Variable — same expression mechanism as everywhere else in the app, just with one extra reserved key in scope."
      }
    }
  },
  "GlobalAction": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/GlobalAction",
    "definitions": {
      "GlobalAction": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "enabled": {
            "type": "boolean",
            "description": "Off keeps the rule in the list (and in the deck export) but skips it entirely during evaluation — the \"comment this out while I debug\" affordance, rather than having to delete and rewrite it."
          },
          "watch": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Variable NAMES (not ids — same by-name convention PluginMapping. variableName uses, and what expressions themselves reference). A rule only re-evaluates when one of these changes, so a deck fed by DCS-BIOS at hundreds of updates a second doesn't re-run every rule's condition on every field. Empty means \"never fires on its own\" rather than \"fires on everything\" — an unscoped rule would reintroduce exactly the cost this exists to avoid."
          },
          "condition": {
            "type": "string",
            "description": "JS function body returning truthy/falsy, evaluated exactly like a ConditionStep's own (see evaluateGlobalCondition in main/index.ts)."
          },
          "trigger": {
            "type": "string",
            "enum": [
              "change",
              "always"
            ],
            "description": "'change' fires only when the condition flips falsy → truthy, and re-arms when it goes back falsy. 'always' fires on every evaluation the watch list triggers, condition permitting — which, for a condition that stays true, means once per incoming variable change, NOT once per cascade round (see runGlobalActions)."
          },
          "steps": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          }
        },
        "required": [
          "id",
          "name",
          "enabled",
          "watch",
          "condition",
          "trigger",
          "steps"
        ],
        "additionalProperties": false,
        "description": "A deck-wide \"if this, then that\" rule, not attached to any widget — see runGlobalActions in main/index.ts. Closely modelled on a React useEffect: `watch` is the dependency array, `condition` + `steps` are the body, and `trigger: 'change'` is the \"only re-run when a dep actually changed\" part.\n\nDeliberately NOT expressed as a widget's own SequenceStep[] starting with a ConditionStep, even though that would be representable today: edge triggering needs one well-defined boolean per rule to compare against the previous evaluation, and a condition nested somewhere mid-sequence has no such single answer. Nested ConditionSteps still work inside `steps` for finer branching underneath this top-level one."
      },
      "SequenceStep": {
        "anyOf": [
          {
            "$ref": "#/definitions/DelayStep"
          },
          {
            "$ref": "#/definitions/ActionStep"
          },
          {
            "$ref": "#/definitions/ConditionStep"
          }
        ]
      },
      "DelayStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "delay"
          },
          "id": {
            "type": "string"
          },
          "delayMs": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "id",
          "delayMs"
        ],
        "additionalProperties": false,
        "description": "A pause between two steps in an event's sequence (see SequenceStep) — not a field on the following action step, so it can be added/removed/ reordered as its own list entry, independent of whatever action (if any) comes after it."
      },
      "ActionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "action"
          },
          "id": {
            "type": "string"
          },
          "action": {
            "$ref": "#/definitions/WidgetAction"
          }
        },
        "required": [
          "kind",
          "id",
          "action"
        ],
        "additionalProperties": false,
        "description": "One WidgetAction embedded in an event's sequence. `id` is independent of anything inside `action` — stable list identity for the properties panel's reorder/delete, same convention as WidgetLabel.id/WidgetState.id."
      },
      "WidgetAction": {
        "anyOf": [
          {
            "$ref": "#/definitions/NoneAction"
          },
          {
            "$ref": "#/definitions/KeypressAction"
          },
          {
            "$ref": "#/definitions/UpdateStateAction"
          },
          {
            "$ref": "#/definitions/SendDcsCommandAction"
          },
          {
            "$ref": "#/definitions/NavigateSubDeckAction"
          },
          {
            "$ref": "#/definitions/OpenOverlayAction"
          },
          {
            "$ref": "#/definitions/CloseOverlayAction"
          },
          {
            "$ref": "#/definitions/CallRestAction"
          },
          {
            "$ref": "#/definitions/SetWindowsAudioAction"
          },
          {
            "$ref": "#/definitions/PlaySoundAction"
          }
        ]
      },
      "NoneAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "none"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "The default for a freshly-added sequence step — does nothing when run (see runActionStep in main/index.ts). Lets a step exist as a placeholder (e.g. mid-sequence, or while deciding what it should do) without silently firing a keypress with no keys bound, which is what an empty-default KeypressAction used to do."
      },
      "KeypressAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "keypress"
          },
          "keys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "mode": {
            "type": "string",
            "enum": [
              "press",
              "down",
              "up"
            ],
            "description": "'press' (default when omitted): atomic press-then-release — the only behavior that existed before this field, still what every existing widget does. 'down'/'up' press or release only, with nothing pairing them automatically — pairing a 'down' step with a later 'up' step (typically with a DelayStep between them, see SequenceStep) is how an \"advanced\" held-key sequence is built, using the same generic sequence mechanism as any other multi-step action rather than a separate editor."
          }
        },
        "required": [
          "kind",
          "keys"
        ],
        "additionalProperties": false
      },
      "UpdateStateAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "update-state"
          },
          "code": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "code"
        ],
        "additionalProperties": false,
        "description": "JS function body, evaluated (see shared/expr.ts) with `states` — the current value of every Variable, keyed by name — in scope. Runs server-side on trigger (see main/index.ts's triggerAction); the returned value is expected to be a plain object of {variableName: newValue}, and every key present gets merged into Dashboard.variables (creating new variables for names that don't exist yet). More action kinds (macro, REST call, ...) can join this union later."
      },
      "SendDcsCommandAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "send-dcs-command"
          },
          "aircraft": {
            "type": "string"
          },
          "identifier": {
            "type": "string"
          },
          "interface": {
            "$ref": "#/definitions/DcsBiosInputInterface"
          },
          "argument": {
            "type": "string"
          },
          "argumentExpr": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "aircraft",
          "identifier",
          "interface",
          "argument"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'dcsbios' is enabled in Settings (see appSettings.ts) — or if a widget already has one configured, so disabling the kind later doesn't silently break existing buttons. `aircraft` scopes which aircraft's command catalog this was picked from (independent of any Plugin — a button isn't tied to one), so re-opening the editor can re-fetch/highlight the same command. `interface` is carried alongside `identifier` since the same identifier can expose more than one interface (e.g. a switch commonly has both `action`/TOGGLE and `set_state`/an explicit position) — each is a wholly separate selectable command with its own argument shape. `argument` is the static value sent unless `argumentExpr` is set, in which case that's evaluated (see shared/expr.ts's tryEvaluateExpression, same mechanism as UpdateStateAction.code) with `variables` in scope and the result sent instead — same fx-toggle pattern as an PluginMapping's own `expr`."
      },
      "DcsBiosInputInterface": {
        "type": "string",
        "enum": [
          "set_state",
          "fixed_step",
          "action",
          "variable_step"
        ]
      },
      "NavigateSubDeckAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "navigate-subdeck"
          },
          "target": {
            "$ref": "#/definitions/SubDeckTarget"
          }
        },
        "required": [
          "kind",
          "target"
        ],
        "additionalProperties": false,
        "description": "Switches which deck view is fullscreen on the triggering client — same visual effect as picking a different deck from the deck picker, but instant (no socket reconnect) since a sub-deck lives in the same Dashboard document (see SubDeck below). Client-local: two devices connected to the same deck can be on two different views at once (see runActionStep in main/index.ts, which replies to the triggering WebSocket only, never broadcasts this). Implicitly closes any open overlay (see OpenOverlayAction) — a fullscreen switch replaces the whole view an overlay would have been layered on top of."
      },
      "SubDeckTarget": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "main-deck"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "sub-deck"
              },
              "subDeckId": {
                "type": "string"
              }
            },
            "required": [
              "type",
              "subDeckId"
            ],
            "additionalProperties": false
          }
        ],
        "description": "Which deck view an action targets: the deck's own main view (its root `widgets`), or one specific sub-deck by id. A tiny discriminated union rather than a bare nullable id string so \"go back to the main deck\" is a real, self-documenting case instead of a magic null/empty-string sentinel. Named distinctly from ScreenRegion/ScreenCaptureWidget's \"screen\" (a physical monitor) — this is a deck-internal view, unrelated."
      },
      "OpenOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "open-overlay"
          },
          "subDeckId": {
            "type": "string"
          },
          "edge": {
            "$ref": "#/definitions/OverlayEdge"
          },
          "size": {
            "type": "number"
          },
          "sizeUnit": {
            "$ref": "#/definitions/OverlaySizeUnit"
          }
        },
        "required": [
          "kind",
          "subDeckId",
          "edge",
          "size",
          "sizeUnit"
        ],
        "additionalProperties": false,
        "description": "Slides a sub-deck in as a panel anchored to one edge of the screen, layered over whatever's currently fullscreen — a lighter-weight alternative to NavigateSubDeckAction for e.g. a settings/menu panel that shouldn't replace the whole view. Always names a specific sub-deck (unlike NavigateSubDeckAction.target, there's no 'main-deck' case here — \"slide the main deck in as a panel over itself\" isn't a meaningful action). Only one overlay open at a time on a given client; opening a second one replaces whichever was already open, and the client also supports dismissing it locally (tap outside, no server round trip) — see CloseOverlayAction for the explicit, sequenceable alternative meant for a close/back button placed inside the panel itself."
      },
      "OverlayEdge": {
        "type": "string",
        "enum": [
          "top",
          "bottom",
          "left",
          "right"
        ]
      },
      "OverlaySizeUnit": {
        "type": "string",
        "enum": [
          "px",
          "percent"
        ]
      },
      "CloseOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "close-overlay"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "Dismisses whichever overlay (if any) is currently open on the device that triggers this — a no-op if none is open. Round-trips through the server like every other action kind (rather than being intercepted client-side) so it composes with delays/other steps in the same sequence, same reasoning as NavigateSubDeckAction/OpenOverlayAction."
      },
      "CallRestAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "call-rest"
          },
          "targetId": {
            "type": "string"
          },
          "values": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/CallRestPlaceholderValue"
            }
          }
        },
        "required": [
          "kind",
          "targetId",
          "values"
        ],
        "additionalProperties": false,
        "description": "Posts a configured RestWebhookTarget's payload (see main/index.ts's runCallRestAction). Only offered in the properties panel for a currently-enabled RestWebhookTarget — or if a widget already has one configured, so disabling/deleting the target later doesn't silently break existing buttons (same convention SendDcsCommandAction's own comment describes for 'dcsbios')."
      },
      "CallRestPlaceholderValue": {
        "type": "object",
        "properties": {
          "placeholder": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "expr": {
            "type": "string"
          }
        },
        "required": [
          "placeholder",
          "value"
        ],
        "additionalProperties": false,
        "description": "One placeholder's resolved value within a CallRestAction — same value/argumentExpr split as SendDcsCommandAction.argument/argumentExpr: `expr` (when set) takes precedence over the static `value`. `placeholder` matches a {{name}} token found in the target RestWebhookTarget's payloadTemplate OR any of its headers' own values at execution time (see extractAllPlaceholders in shared/restPlaceholders.ts) — a stale entry whose token no longer exists anywhere is simply ignored, not an error."
      },
      "SetWindowsAudioAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "set-windows-audio"
          },
          "deviceName": {
            "type": "string"
          },
          "appName": {
            "type": "string"
          },
          "volume": {
            "type": "string"
          },
          "volumeExpr": {
            "type": "string"
          },
          "muteAction": {
            "type": "string",
            "enum": [
              "mute",
              "unmute",
              "toggle"
            ]
          }
        },
        "required": [
          "kind",
          "deviceName"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'windowsAudio' is enabled in Settings — or if a widget already has one configured, same don't-silently-break-an-existing-button convention SendDcsCommandAction's own comment describes for 'dcsbios'. `deviceName` is '' for \"whichever device is currently the default output\" or an exact name from windows-audio:devices — native-sound-mixer's Device has no stable id (see main/windowsAudio/worker.ts's own comment), so name is the only handle there is; renaming/replacing hardware can silently break a by-name pick, same risk a REST source's own free-text field carries. `volume` is the static 0-100 value sent unless `volumeExpr` is set, same plain-value/expr-override precedence as SendDcsCommandAction.argument/ argumentExpr; both unset means \"don't touch volume, only muteAction (if set)\". `muteAction` is a tri-state action rather than a plain boolean so \"leave mute alone\" (undefined) is distinguishable from \"unmute\" (false would be ambiguous with \"not set\" otherwise). `appName` is undefined for device mode (the shape above) or set to target one application's own audio session instead — see windows-audio:sessions for where its options come from. Additive rather than a nested discriminated union so an action saved before app-session targeting existed still reads the same (device mode, `deviceName` as before) with no migration needed. A session is always on whichever device is CURRENTLY the system default (see main/windowsAudio/connectionManager.ts's own comment on why), so `deviceName` is simply ignored while `appName` is set."
      },
      "PlaySoundAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "play-sound"
          },
          "soundId": {
            "type": "string",
            "description": "A CustomSound.id. An id whose sound has since been deleted plays nothing rather than erroring — same silent-no-op posture as a missing font, since a sound failing to play shouldn't abort the rest of a sequence mid-flight."
          },
          "target": {
            "type": "string",
            "enum": [
              "server",
              "client",
              "both"
            ]
          },
          "serverVolume": {
            "type": "number",
            "description": "0-100 each, independent: the PC's speakers and a tablet in the cockpit are rarely at a comparable level, so one shared number would mean getting one of them wrong. Converted to HTMLAudioElement gain by soundVolumeToGain (shared/sounds.ts)."
          },
          "clientVolume": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "soundId",
          "target",
          "serverVolume",
          "clientVolume"
        ],
        "additionalProperties": false,
        "description": "Plays one sound from the app-wide library (see shared/sounds.ts) — on the machine running Boarderoni, on the device that triggered the action, or both. There's no main-process audio API, so \"server\" playback is really the editor window's own renderer doing it (see playSoundOnServer in main/index.ts); the editor window is hidden-not-destroyed when minimized to tray, so this still works with no window on screen."
      },
      "ConditionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "condition"
          },
          "id": {
            "type": "string"
          },
          "condition": {
            "type": "string"
          },
          "whenTrue": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          },
          "whenFalse": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          }
        },
        "required": [
          "kind",
          "id",
          "condition",
          "whenTrue",
          "whenFalse"
        ],
        "additionalProperties": false,
        "description": "A boolean fork inside an event's sequence — evaluates `condition` (same mechanism as UpdateStateAction.code; see evaluateConditionStep in main/index.ts) and runs one of two nested SequenceStep[] branches instead of falling through to the next flat entry. This is the only place SequenceStep is recursive. `id` is independent of both branches' own step ids, same convention as every other step kind."
      }
    }
  },
  "WidgetAction": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/WidgetAction",
    "definitions": {
      "WidgetAction": {
        "anyOf": [
          {
            "$ref": "#/definitions/NoneAction"
          },
          {
            "$ref": "#/definitions/KeypressAction"
          },
          {
            "$ref": "#/definitions/UpdateStateAction"
          },
          {
            "$ref": "#/definitions/SendDcsCommandAction"
          },
          {
            "$ref": "#/definitions/NavigateSubDeckAction"
          },
          {
            "$ref": "#/definitions/OpenOverlayAction"
          },
          {
            "$ref": "#/definitions/CloseOverlayAction"
          },
          {
            "$ref": "#/definitions/CallRestAction"
          },
          {
            "$ref": "#/definitions/SetWindowsAudioAction"
          },
          {
            "$ref": "#/definitions/PlaySoundAction"
          }
        ]
      },
      "NoneAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "none"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "The default for a freshly-added sequence step — does nothing when run (see runActionStep in main/index.ts). Lets a step exist as a placeholder (e.g. mid-sequence, or while deciding what it should do) without silently firing a keypress with no keys bound, which is what an empty-default KeypressAction used to do."
      },
      "KeypressAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "keypress"
          },
          "keys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "mode": {
            "type": "string",
            "enum": [
              "press",
              "down",
              "up"
            ],
            "description": "'press' (default when omitted): atomic press-then-release — the only behavior that existed before this field, still what every existing widget does. 'down'/'up' press or release only, with nothing pairing them automatically — pairing a 'down' step with a later 'up' step (typically with a DelayStep between them, see SequenceStep) is how an \"advanced\" held-key sequence is built, using the same generic sequence mechanism as any other multi-step action rather than a separate editor."
          }
        },
        "required": [
          "kind",
          "keys"
        ],
        "additionalProperties": false
      },
      "UpdateStateAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "update-state"
          },
          "code": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "code"
        ],
        "additionalProperties": false,
        "description": "JS function body, evaluated (see shared/expr.ts) with `states` — the current value of every Variable, keyed by name — in scope. Runs server-side on trigger (see main/index.ts's triggerAction); the returned value is expected to be a plain object of {variableName: newValue}, and every key present gets merged into Dashboard.variables (creating new variables for names that don't exist yet). More action kinds (macro, REST call, ...) can join this union later."
      },
      "SendDcsCommandAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "send-dcs-command"
          },
          "aircraft": {
            "type": "string"
          },
          "identifier": {
            "type": "string"
          },
          "interface": {
            "$ref": "#/definitions/DcsBiosInputInterface"
          },
          "argument": {
            "type": "string"
          },
          "argumentExpr": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "aircraft",
          "identifier",
          "interface",
          "argument"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'dcsbios' is enabled in Settings (see appSettings.ts) — or if a widget already has one configured, so disabling the kind later doesn't silently break existing buttons. `aircraft` scopes which aircraft's command catalog this was picked from (independent of any Plugin — a button isn't tied to one), so re-opening the editor can re-fetch/highlight the same command. `interface` is carried alongside `identifier` since the same identifier can expose more than one interface (e.g. a switch commonly has both `action`/TOGGLE and `set_state`/an explicit position) — each is a wholly separate selectable command with its own argument shape. `argument` is the static value sent unless `argumentExpr` is set, in which case that's evaluated (see shared/expr.ts's tryEvaluateExpression, same mechanism as UpdateStateAction.code) with `variables` in scope and the result sent instead — same fx-toggle pattern as an PluginMapping's own `expr`."
      },
      "DcsBiosInputInterface": {
        "type": "string",
        "enum": [
          "set_state",
          "fixed_step",
          "action",
          "variable_step"
        ]
      },
      "NavigateSubDeckAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "navigate-subdeck"
          },
          "target": {
            "$ref": "#/definitions/SubDeckTarget"
          }
        },
        "required": [
          "kind",
          "target"
        ],
        "additionalProperties": false,
        "description": "Switches which deck view is fullscreen on the triggering client — same visual effect as picking a different deck from the deck picker, but instant (no socket reconnect) since a sub-deck lives in the same Dashboard document (see SubDeck below). Client-local: two devices connected to the same deck can be on two different views at once (see runActionStep in main/index.ts, which replies to the triggering WebSocket only, never broadcasts this). Implicitly closes any open overlay (see OpenOverlayAction) — a fullscreen switch replaces the whole view an overlay would have been layered on top of."
      },
      "SubDeckTarget": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "main-deck"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "sub-deck"
              },
              "subDeckId": {
                "type": "string"
              }
            },
            "required": [
              "type",
              "subDeckId"
            ],
            "additionalProperties": false
          }
        ],
        "description": "Which deck view an action targets: the deck's own main view (its root `widgets`), or one specific sub-deck by id. A tiny discriminated union rather than a bare nullable id string so \"go back to the main deck\" is a real, self-documenting case instead of a magic null/empty-string sentinel. Named distinctly from ScreenRegion/ScreenCaptureWidget's \"screen\" (a physical monitor) — this is a deck-internal view, unrelated."
      },
      "OpenOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "open-overlay"
          },
          "subDeckId": {
            "type": "string"
          },
          "edge": {
            "$ref": "#/definitions/OverlayEdge"
          },
          "size": {
            "type": "number"
          },
          "sizeUnit": {
            "$ref": "#/definitions/OverlaySizeUnit"
          }
        },
        "required": [
          "kind",
          "subDeckId",
          "edge",
          "size",
          "sizeUnit"
        ],
        "additionalProperties": false,
        "description": "Slides a sub-deck in as a panel anchored to one edge of the screen, layered over whatever's currently fullscreen — a lighter-weight alternative to NavigateSubDeckAction for e.g. a settings/menu panel that shouldn't replace the whole view. Always names a specific sub-deck (unlike NavigateSubDeckAction.target, there's no 'main-deck' case here — \"slide the main deck in as a panel over itself\" isn't a meaningful action). Only one overlay open at a time on a given client; opening a second one replaces whichever was already open, and the client also supports dismissing it locally (tap outside, no server round trip) — see CloseOverlayAction for the explicit, sequenceable alternative meant for a close/back button placed inside the panel itself."
      },
      "OverlayEdge": {
        "type": "string",
        "enum": [
          "top",
          "bottom",
          "left",
          "right"
        ]
      },
      "OverlaySizeUnit": {
        "type": "string",
        "enum": [
          "px",
          "percent"
        ]
      },
      "CloseOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "close-overlay"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "Dismisses whichever overlay (if any) is currently open on the device that triggers this — a no-op if none is open. Round-trips through the server like every other action kind (rather than being intercepted client-side) so it composes with delays/other steps in the same sequence, same reasoning as NavigateSubDeckAction/OpenOverlayAction."
      },
      "CallRestAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "call-rest"
          },
          "targetId": {
            "type": "string"
          },
          "values": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/CallRestPlaceholderValue"
            }
          }
        },
        "required": [
          "kind",
          "targetId",
          "values"
        ],
        "additionalProperties": false,
        "description": "Posts a configured RestWebhookTarget's payload (see main/index.ts's runCallRestAction). Only offered in the properties panel for a currently-enabled RestWebhookTarget — or if a widget already has one configured, so disabling/deleting the target later doesn't silently break existing buttons (same convention SendDcsCommandAction's own comment describes for 'dcsbios')."
      },
      "CallRestPlaceholderValue": {
        "type": "object",
        "properties": {
          "placeholder": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "expr": {
            "type": "string"
          }
        },
        "required": [
          "placeholder",
          "value"
        ],
        "additionalProperties": false,
        "description": "One placeholder's resolved value within a CallRestAction — same value/argumentExpr split as SendDcsCommandAction.argument/argumentExpr: `expr` (when set) takes precedence over the static `value`. `placeholder` matches a {{name}} token found in the target RestWebhookTarget's payloadTemplate OR any of its headers' own values at execution time (see extractAllPlaceholders in shared/restPlaceholders.ts) — a stale entry whose token no longer exists anywhere is simply ignored, not an error."
      },
      "SetWindowsAudioAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "set-windows-audio"
          },
          "deviceName": {
            "type": "string"
          },
          "appName": {
            "type": "string"
          },
          "volume": {
            "type": "string"
          },
          "volumeExpr": {
            "type": "string"
          },
          "muteAction": {
            "type": "string",
            "enum": [
              "mute",
              "unmute",
              "toggle"
            ]
          }
        },
        "required": [
          "kind",
          "deviceName"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'windowsAudio' is enabled in Settings — or if a widget already has one configured, same don't-silently-break-an-existing-button convention SendDcsCommandAction's own comment describes for 'dcsbios'. `deviceName` is '' for \"whichever device is currently the default output\" or an exact name from windows-audio:devices — native-sound-mixer's Device has no stable id (see main/windowsAudio/worker.ts's own comment), so name is the only handle there is; renaming/replacing hardware can silently break a by-name pick, same risk a REST source's own free-text field carries. `volume` is the static 0-100 value sent unless `volumeExpr` is set, same plain-value/expr-override precedence as SendDcsCommandAction.argument/ argumentExpr; both unset means \"don't touch volume, only muteAction (if set)\". `muteAction` is a tri-state action rather than a plain boolean so \"leave mute alone\" (undefined) is distinguishable from \"unmute\" (false would be ambiguous with \"not set\" otherwise). `appName` is undefined for device mode (the shape above) or set to target one application's own audio session instead — see windows-audio:sessions for where its options come from. Additive rather than a nested discriminated union so an action saved before app-session targeting existed still reads the same (device mode, `deviceName` as before) with no migration needed. A session is always on whichever device is CURRENTLY the system default (see main/windowsAudio/connectionManager.ts's own comment on why), so `deviceName` is simply ignored while `appName` is set."
      },
      "PlaySoundAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "play-sound"
          },
          "soundId": {
            "type": "string",
            "description": "A CustomSound.id. An id whose sound has since been deleted plays nothing rather than erroring — same silent-no-op posture as a missing font, since a sound failing to play shouldn't abort the rest of a sequence mid-flight."
          },
          "target": {
            "type": "string",
            "enum": [
              "server",
              "client",
              "both"
            ]
          },
          "serverVolume": {
            "type": "number",
            "description": "0-100 each, independent: the PC's speakers and a tablet in the cockpit are rarely at a comparable level, so one shared number would mean getting one of them wrong. Converted to HTMLAudioElement gain by soundVolumeToGain (shared/sounds.ts)."
          },
          "clientVolume": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "soundId",
          "target",
          "serverVolume",
          "clientVolume"
        ],
        "additionalProperties": false,
        "description": "Plays one sound from the app-wide library (see shared/sounds.ts) — on the machine running Boarderoni, on the device that triggered the action, or both. There's no main-process audio API, so \"server\" playback is really the editor window's own renderer doing it (see playSoundOnServer in main/index.ts); the editor window is hidden-not-destroyed when minimized to tray, so this still works with no window on screen."
      }
    }
  },
  "SequenceStep": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$ref": "#/definitions/SequenceStep",
    "definitions": {
      "SequenceStep": {
        "anyOf": [
          {
            "$ref": "#/definitions/DelayStep"
          },
          {
            "$ref": "#/definitions/ActionStep"
          },
          {
            "$ref": "#/definitions/ConditionStep"
          }
        ]
      },
      "DelayStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "delay"
          },
          "id": {
            "type": "string"
          },
          "delayMs": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "id",
          "delayMs"
        ],
        "additionalProperties": false,
        "description": "A pause between two steps in an event's sequence (see SequenceStep) — not a field on the following action step, so it can be added/removed/ reordered as its own list entry, independent of whatever action (if any) comes after it."
      },
      "ActionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "action"
          },
          "id": {
            "type": "string"
          },
          "action": {
            "$ref": "#/definitions/WidgetAction"
          }
        },
        "required": [
          "kind",
          "id",
          "action"
        ],
        "additionalProperties": false,
        "description": "One WidgetAction embedded in an event's sequence. `id` is independent of anything inside `action` — stable list identity for the properties panel's reorder/delete, same convention as WidgetLabel.id/WidgetState.id."
      },
      "WidgetAction": {
        "anyOf": [
          {
            "$ref": "#/definitions/NoneAction"
          },
          {
            "$ref": "#/definitions/KeypressAction"
          },
          {
            "$ref": "#/definitions/UpdateStateAction"
          },
          {
            "$ref": "#/definitions/SendDcsCommandAction"
          },
          {
            "$ref": "#/definitions/NavigateSubDeckAction"
          },
          {
            "$ref": "#/definitions/OpenOverlayAction"
          },
          {
            "$ref": "#/definitions/CloseOverlayAction"
          },
          {
            "$ref": "#/definitions/CallRestAction"
          },
          {
            "$ref": "#/definitions/SetWindowsAudioAction"
          },
          {
            "$ref": "#/definitions/PlaySoundAction"
          }
        ]
      },
      "NoneAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "none"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "The default for a freshly-added sequence step — does nothing when run (see runActionStep in main/index.ts). Lets a step exist as a placeholder (e.g. mid-sequence, or while deciding what it should do) without silently firing a keypress with no keys bound, which is what an empty-default KeypressAction used to do."
      },
      "KeypressAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "keypress"
          },
          "keys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "mode": {
            "type": "string",
            "enum": [
              "press",
              "down",
              "up"
            ],
            "description": "'press' (default when omitted): atomic press-then-release — the only behavior that existed before this field, still what every existing widget does. 'down'/'up' press or release only, with nothing pairing them automatically — pairing a 'down' step with a later 'up' step (typically with a DelayStep between them, see SequenceStep) is how an \"advanced\" held-key sequence is built, using the same generic sequence mechanism as any other multi-step action rather than a separate editor."
          }
        },
        "required": [
          "kind",
          "keys"
        ],
        "additionalProperties": false
      },
      "UpdateStateAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "update-state"
          },
          "code": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "code"
        ],
        "additionalProperties": false,
        "description": "JS function body, evaluated (see shared/expr.ts) with `states` — the current value of every Variable, keyed by name — in scope. Runs server-side on trigger (see main/index.ts's triggerAction); the returned value is expected to be a plain object of {variableName: newValue}, and every key present gets merged into Dashboard.variables (creating new variables for names that don't exist yet). More action kinds (macro, REST call, ...) can join this union later."
      },
      "SendDcsCommandAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "send-dcs-command"
          },
          "aircraft": {
            "type": "string"
          },
          "identifier": {
            "type": "string"
          },
          "interface": {
            "$ref": "#/definitions/DcsBiosInputInterface"
          },
          "argument": {
            "type": "string"
          },
          "argumentExpr": {
            "type": "string"
          }
        },
        "required": [
          "kind",
          "aircraft",
          "identifier",
          "interface",
          "argument"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'dcsbios' is enabled in Settings (see appSettings.ts) — or if a widget already has one configured, so disabling the kind later doesn't silently break existing buttons. `aircraft` scopes which aircraft's command catalog this was picked from (independent of any Plugin — a button isn't tied to one), so re-opening the editor can re-fetch/highlight the same command. `interface` is carried alongside `identifier` since the same identifier can expose more than one interface (e.g. a switch commonly has both `action`/TOGGLE and `set_state`/an explicit position) — each is a wholly separate selectable command with its own argument shape. `argument` is the static value sent unless `argumentExpr` is set, in which case that's evaluated (see shared/expr.ts's tryEvaluateExpression, same mechanism as UpdateStateAction.code) with `variables` in scope and the result sent instead — same fx-toggle pattern as an PluginMapping's own `expr`."
      },
      "DcsBiosInputInterface": {
        "type": "string",
        "enum": [
          "set_state",
          "fixed_step",
          "action",
          "variable_step"
        ]
      },
      "NavigateSubDeckAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "navigate-subdeck"
          },
          "target": {
            "$ref": "#/definitions/SubDeckTarget"
          }
        },
        "required": [
          "kind",
          "target"
        ],
        "additionalProperties": false,
        "description": "Switches which deck view is fullscreen on the triggering client — same visual effect as picking a different deck from the deck picker, but instant (no socket reconnect) since a sub-deck lives in the same Dashboard document (see SubDeck below). Client-local: two devices connected to the same deck can be on two different views at once (see runActionStep in main/index.ts, which replies to the triggering WebSocket only, never broadcasts this). Implicitly closes any open overlay (see OpenOverlayAction) — a fullscreen switch replaces the whole view an overlay would have been layered on top of."
      },
      "SubDeckTarget": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "main-deck"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "sub-deck"
              },
              "subDeckId": {
                "type": "string"
              }
            },
            "required": [
              "type",
              "subDeckId"
            ],
            "additionalProperties": false
          }
        ],
        "description": "Which deck view an action targets: the deck's own main view (its root `widgets`), or one specific sub-deck by id. A tiny discriminated union rather than a bare nullable id string so \"go back to the main deck\" is a real, self-documenting case instead of a magic null/empty-string sentinel. Named distinctly from ScreenRegion/ScreenCaptureWidget's \"screen\" (a physical monitor) — this is a deck-internal view, unrelated."
      },
      "OpenOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "open-overlay"
          },
          "subDeckId": {
            "type": "string"
          },
          "edge": {
            "$ref": "#/definitions/OverlayEdge"
          },
          "size": {
            "type": "number"
          },
          "sizeUnit": {
            "$ref": "#/definitions/OverlaySizeUnit"
          }
        },
        "required": [
          "kind",
          "subDeckId",
          "edge",
          "size",
          "sizeUnit"
        ],
        "additionalProperties": false,
        "description": "Slides a sub-deck in as a panel anchored to one edge of the screen, layered over whatever's currently fullscreen — a lighter-weight alternative to NavigateSubDeckAction for e.g. a settings/menu panel that shouldn't replace the whole view. Always names a specific sub-deck (unlike NavigateSubDeckAction.target, there's no 'main-deck' case here — \"slide the main deck in as a panel over itself\" isn't a meaningful action). Only one overlay open at a time on a given client; opening a second one replaces whichever was already open, and the client also supports dismissing it locally (tap outside, no server round trip) — see CloseOverlayAction for the explicit, sequenceable alternative meant for a close/back button placed inside the panel itself."
      },
      "OverlayEdge": {
        "type": "string",
        "enum": [
          "top",
          "bottom",
          "left",
          "right"
        ]
      },
      "OverlaySizeUnit": {
        "type": "string",
        "enum": [
          "px",
          "percent"
        ]
      },
      "CloseOverlayAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "close-overlay"
          }
        },
        "required": [
          "kind"
        ],
        "additionalProperties": false,
        "description": "Dismisses whichever overlay (if any) is currently open on the device that triggers this — a no-op if none is open. Round-trips through the server like every other action kind (rather than being intercepted client-side) so it composes with delays/other steps in the same sequence, same reasoning as NavigateSubDeckAction/OpenOverlayAction."
      },
      "CallRestAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "call-rest"
          },
          "targetId": {
            "type": "string"
          },
          "values": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/CallRestPlaceholderValue"
            }
          }
        },
        "required": [
          "kind",
          "targetId",
          "values"
        ],
        "additionalProperties": false,
        "description": "Posts a configured RestWebhookTarget's payload (see main/index.ts's runCallRestAction). Only offered in the properties panel for a currently-enabled RestWebhookTarget — or if a widget already has one configured, so disabling/deleting the target later doesn't silently break existing buttons (same convention SendDcsCommandAction's own comment describes for 'dcsbios')."
      },
      "CallRestPlaceholderValue": {
        "type": "object",
        "properties": {
          "placeholder": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "expr": {
            "type": "string"
          }
        },
        "required": [
          "placeholder",
          "value"
        ],
        "additionalProperties": false,
        "description": "One placeholder's resolved value within a CallRestAction — same value/argumentExpr split as SendDcsCommandAction.argument/argumentExpr: `expr` (when set) takes precedence over the static `value`. `placeholder` matches a {{name}} token found in the target RestWebhookTarget's payloadTemplate OR any of its headers' own values at execution time (see extractAllPlaceholders in shared/restPlaceholders.ts) — a stale entry whose token no longer exists anywhere is simply ignored, not an error."
      },
      "SetWindowsAudioAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "set-windows-audio"
          },
          "deviceName": {
            "type": "string"
          },
          "appName": {
            "type": "string"
          },
          "volume": {
            "type": "string"
          },
          "volumeExpr": {
            "type": "string"
          },
          "muteAction": {
            "type": "string",
            "enum": [
              "mute",
              "unmute",
              "toggle"
            ]
          }
        },
        "required": [
          "kind",
          "deviceName"
        ],
        "additionalProperties": false,
        "description": "Only offered in the properties panel while 'windowsAudio' is enabled in Settings — or if a widget already has one configured, same don't-silently-break-an-existing-button convention SendDcsCommandAction's own comment describes for 'dcsbios'. `deviceName` is '' for \"whichever device is currently the default output\" or an exact name from windows-audio:devices — native-sound-mixer's Device has no stable id (see main/windowsAudio/worker.ts's own comment), so name is the only handle there is; renaming/replacing hardware can silently break a by-name pick, same risk a REST source's own free-text field carries. `volume` is the static 0-100 value sent unless `volumeExpr` is set, same plain-value/expr-override precedence as SendDcsCommandAction.argument/ argumentExpr; both unset means \"don't touch volume, only muteAction (if set)\". `muteAction` is a tri-state action rather than a plain boolean so \"leave mute alone\" (undefined) is distinguishable from \"unmute\" (false would be ambiguous with \"not set\" otherwise). `appName` is undefined for device mode (the shape above) or set to target one application's own audio session instead — see windows-audio:sessions for where its options come from. Additive rather than a nested discriminated union so an action saved before app-session targeting existed still reads the same (device mode, `deviceName` as before) with no migration needed. A session is always on whichever device is CURRENTLY the system default (see main/windowsAudio/connectionManager.ts's own comment on why), so `deviceName` is simply ignored while `appName` is set."
      },
      "PlaySoundAction": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "play-sound"
          },
          "soundId": {
            "type": "string",
            "description": "A CustomSound.id. An id whose sound has since been deleted plays nothing rather than erroring — same silent-no-op posture as a missing font, since a sound failing to play shouldn't abort the rest of a sequence mid-flight."
          },
          "target": {
            "type": "string",
            "enum": [
              "server",
              "client",
              "both"
            ]
          },
          "serverVolume": {
            "type": "number",
            "description": "0-100 each, independent: the PC's speakers and a tablet in the cockpit are rarely at a comparable level, so one shared number would mean getting one of them wrong. Converted to HTMLAudioElement gain by soundVolumeToGain (shared/sounds.ts)."
          },
          "clientVolume": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "soundId",
          "target",
          "serverVolume",
          "clientVolume"
        ],
        "additionalProperties": false,
        "description": "Plays one sound from the app-wide library (see shared/sounds.ts) — on the machine running Boarderoni, on the device that triggered the action, or both. There's no main-process audio API, so \"server\" playback is really the editor window's own renderer doing it (see playSoundOnServer in main/index.ts); the editor window is hidden-not-destroyed when minimized to tray, so this still works with no window on screen."
      },
      "ConditionStep": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "const": "condition"
          },
          "id": {
            "type": "string"
          },
          "condition": {
            "type": "string"
          },
          "whenTrue": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          },
          "whenFalse": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
          }
        },
        "required": [
          "kind",
          "id",
          "condition",
          "whenTrue",
          "whenFalse"
        ],
        "additionalProperties": false,
        "description": "A boolean fork inside an event's sequence — evaluates `condition` (same mechanism as UpdateStateAction.code; see evaluateConditionStep in main/index.ts) and runs one of two nested SequenceStep[] branches instead of falling through to the next flat entry. This is the only place SequenceStep is recursive. `id` is independent of both branches' own step ids, same convention as every other step kind."
      }
    }
  }
} as const
