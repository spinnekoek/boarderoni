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
            "type": "string"
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
            "additionalProperties": false
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
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
            ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
      },
      "WidgetState": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          },
          "spacingTop": {
            "type": "number"
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
            "type": "number"
          },
          "isClicked": {
            "type": "boolean"
          },
          "glowColor": {
            "type": "string"
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
        "additionalProperties": false
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
            "type": "string"
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
            "type": "string"
          },
          "textOpacity": {
            "type": "number"
          },
          "backgroundColor": {
            "type": "string"
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "align": {
            "$ref": "#/definitions/HorizontalAlign"
          },
          "verticalAlign": {
            "$ref": "#/definitions/VerticalAlign"
          },
          "textAlign": {
            "$ref": "#/definitions/HorizontalAlign"
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
            ]
          },
          "labelAnchor": {
            "type": "string",
            "enum": [
              "top",
              "bottom",
              "left",
              "right"
            ]
          },
          "labelDistance": {
            "type": "number"
          },
          "offsetX": {
            "type": "number"
          },
          "offsetY": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "text"
        ],
        "additionalProperties": false
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
            "type": "string"
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
            "additionalProperties": false
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
            "type": "boolean"
          },
          "valueExpr": {
            "type": "string"
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
        "additionalProperties": false
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
        "additionalProperties": false
      },
      "MorphBlockStateOverride": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          },
          "spacingTop": {
            "type": "number"
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
          "autoFit": {
            "type": "boolean"
          }
        },
        "additionalProperties": false
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
            "type": "string"
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
            "type": "string"
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
            "type": "string"
          },
          "backgroundOpacity": {
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
            "type": "string"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "borderOpacity": {
            "type": "number"
          }
        },
        "additionalProperties": false
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
            "type": "string"
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
            "type": "string"
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
            "type": "string"
          },
          "backgroundOpacity": {
            "type": "number"
          },
          "tickSets": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/GaugeTickSet"
            }
          },
          "showIndicator": {
            "type": "boolean"
          },
          "showIndicatorExpr": {
            "type": "string"
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "needle",
              "square"
            ]
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorStartDistance": {
            "type": "number"
          },
          "indicatorEndDistance": {
            "type": "number"
          },
          "indicatorWidth": {
            "type": "number"
          },
          "indicatorCenterSize": {
            "type": "number"
          },
          "indicatorCenterColor": {
            "type": "string"
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
            "type": "number"
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
            "type": "number"
          },
          "thickness": {
            "type": "number"
          },
          "distance": {
            "type": "number"
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
            "type": "number"
          },
          "labelMin": {
            "type": "number"
          },
          "labelMax": {
            "type": "number"
          },
          "labelDistance": {
            "type": "number"
          },
          "labelTextExpr": {
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
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
            "type": "string"
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
            "type": "string"
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
            "additionalProperties": false
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
            ]
          },
          "handleSize": {
            "type": "number"
          },
          "handleWidth": {
            "type": "number"
          },
          "handleHeight": {
            "type": "number"
          },
          "handleRadius": {
            "type": "number"
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
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
            "type": "string"
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ]
          },
          "dialDistance": {
            "type": "number"
          },
          "squareWidth": {
            "type": "number"
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
            "type": "number"
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
            "type": "number"
          },
          "circleIndentSize": {
            "type": "number"
          },
          "circleIndentColor": {
            "type": "string"
          },
          "circleIndentOpacity": {
            "type": "number"
          },
          "circleIndentDistance": {
            "type": "number"
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ]
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ]
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number"
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle"
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
            "type": "string"
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
            "additionalProperties": false
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
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
          },
          "borderOpacity": {
            "type": "number"
          },
          "bezelRadius": {
            "type": "number"
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
            "type": "number"
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
            }
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
        "additionalProperties": false
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
        "additionalProperties": false
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
            "type": "string"
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ]
          },
          "dialDistance": {
            "type": "number"
          },
          "squareWidth": {
            "type": "number"
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
            "type": "number"
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
            "type": "number"
          },
          "circleIndentSize": {
            "type": "number"
          },
          "circleIndentColor": {
            "type": "string"
          },
          "circleIndentOpacity": {
            "type": "number"
          },
          "circleIndentDistance": {
            "type": "number"
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ]
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ]
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number"
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle"
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
            "type": "number"
          },
          "valueExpr": {
            "type": "string"
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
            "additionalProperties": false
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
            "type": "number"
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
            "type": "number"
          },
          "thickness": {
            "type": "number"
          },
          "distance": {
            "type": "number"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
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
            "type": "string"
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
            "additionalProperties": false
          },
          "labels": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/WidgetLabel"
            }
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
          },
          "settleToInactive": {
            "type": "boolean"
          },
          "onInactive": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/SequenceStep"
            }
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
        "additionalProperties": false
      },
      "SwitchPosition": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string"
          },
          "colorExpr": {
            "type": "string"
          },
          "borderColor": {
            "type": "string"
          },
          "borderColorExpr": {
            "type": "string"
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
            }
          },
          "activeColor": {
            "type": "string"
          },
          "activeColorExpr": {
            "type": "string"
          },
          "activeOpacity": {
            "type": "number"
          },
          "momentary": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "name",
          "labels",
          "onSelect"
        ],
        "additionalProperties": false
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
            "type": "string"
          },
          "dialShape": {
            "type": "string",
            "enum": [
              "needle",
              "square",
              "circle",
              "none"
            ]
          },
          "dialDistance": {
            "type": "number"
          },
          "squareWidth": {
            "type": "number"
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
            "type": "number"
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
            "type": "number"
          },
          "circleIndentSize": {
            "type": "number"
          },
          "circleIndentColor": {
            "type": "string"
          },
          "circleIndentOpacity": {
            "type": "number"
          },
          "circleIndentDistance": {
            "type": "number"
          },
          "circleIndentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle"
            ]
          },
          "indicatorShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ]
          },
          "indicatorStyle": {
            "$ref": "#/definitions/DetentStyle"
          },
          "indicatorColor": {
            "type": "string"
          },
          "indicatorDistance": {
            "type": "number"
          },
          "indicatorSquareBorder": {
            "$ref": "#/definitions/SquareBorderStyle"
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
            }
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
            "additionalProperties": false
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
            ]
          },
          "fireWhileDragging": {
            "type": "boolean"
          },
          "waitForStateConfirm": {
            "type": "boolean"
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
          "detentShape": {
            "type": "string",
            "enum": [
              "circle",
              "square",
              "tick",
              "triangle",
              "none"
            ]
          },
          "detentRadius": {
            "type": "number"
          },
          "detentStyle": {
            "$ref": "#/definitions/DetentStyle"
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
        "additionalProperties": false
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
            "type": "string"
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
            }
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
            "additionalProperties": false
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
            ]
          },
          "fireWhileDragging": {
            "type": "boolean"
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
            "type": "number"
          },
          "bezelRadius": {
            "type": "number"
          },
          "bezelShape": {
            "type": "string",
            "enum": [
              "circle",
              "hexagon"
            ]
          },
          "bezelRotation": {
            "type": "number"
          },
          "innerBezelColor": {
            "type": "string"
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
            "type": "number"
          },
          "leverBorderColor": {
            "type": "string"
          },
          "leverBorderWidth": {
            "type": "number"
          },
          "leverTipRadius": {
            "type": "number"
          },
          "leverBaseRadius": {
            "type": "number"
          },
          "leverShape": {
            "type": "string",
            "enum": [
              "normal",
              "bar"
            ]
          },
          "circleColor": {
            "type": "string"
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
            ]
          },
          "barWidth": {
            "type": "number"
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
            "type": "boolean"
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
            "type": "number"
          },
          "guardHeight": {
            "type": "number"
          },
          "guardTop": {
            "type": "number"
          },
          "guardOpenHeight": {
            "type": "number"
          },
          "guardOpenTop": {
            "type": "number"
          },
          "guardOpenExpr": {
            "type": "string"
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
        "additionalProperties": false
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
            "type": "string"
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
            ]
          },
          "expandMode": {
            "type": "string",
            "enum": [
              "anchored",
              "unanchored"
            ]
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
        "additionalProperties": false
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
            "type": "string"
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
            "type": "number"
          },
          "region": {
            "$ref": "#/definitions/ScreenRegion"
          },
          "streamMode": {
            "type": "string",
            "enum": [
              "poll",
              "mjpeg"
            ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
            "type": "string"
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
            "type": "number"
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
            "type": "boolean"
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
        "additionalProperties": false
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
            "type": "string"
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
        "additionalProperties": false
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
            "type": "string"
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
            "type": "number"
          },
          "rotateAngle": {
            "type": "number"
          },
          "rotateAngleExpr": {
            "type": "string"
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
        "additionalProperties": false
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
        "additionalProperties": false
      },
      "VariableValue": {
        "type": [
          "string",
          "number",
          "boolean"
        ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
            "type": "boolean"
          },
          "watch": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "condition": {
            "type": "string"
          },
          "trigger": {
            "type": "string",
            "enum": [
              "change",
              "always"
            ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
            ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        ]
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
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
        "additionalProperties": false
      }
    }
  }
} as const
