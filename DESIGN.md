---
name: Discord Hack Cleaner
description: Compact in-Discord incident review
colors:
  canvas: "#1e1f22"
  surface: "#2b2d31"
  raised: "#313338"
  floating: "#111214"
  line: "#3f4147"
  heading: "#f2f3f5"
  text: "#dbdee1"
  muted: "#b5bac1"
  accent: "#5865f2"
  danger: "#da373c"
typography:
  body:
    fontFamily: "gg sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13px"
  title:
    fontFamily: "gg sans, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    lineHeight: 1.25
rounded:
  control: "4px"
  panel: "8px"
spacing:
  tight: "6px"
  panel: "12px"
---

## Overview

A compact dark utility panel inside Discord Web. The incumbent styles live in `src/ui.css`, and the scanner builds its controls in `src/scanner.js`.

## Colors

Discord-like neutral surfaces separate the header, form and footer. Blurple identifies the main scan action. Red is reserved for destructive actions.

## Layout

The regular panel is up to 380 pixels wide. Dates and scope use short labels beside their fields. The footer holds the main action and access to results. Results and settings open beside the panel when space allows and overlay it on narrow screens.

## Components

Use native date inputs, selects, and disclosure elements. Keep saved scans and advanced tools closed initially. Show pause and stop only during an operation.
