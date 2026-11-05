// See LICENSE file in the project root for license information.

import type { ITheme } from "@xterm/xterm";

type CssThemeKey = Exclude<keyof ITheme, "extendedAnsi">;

type ThemeEntry = readonly [CssThemeKey, `--${string}`];

const theme_entries: ReadonlyArray<ThemeEntry> = [
  ["background", "--terminal-background"],
  ["black", "--terminal-black"],
  ["blue", "--terminal-blue"],
  ["brightBlack", "--terminal-bright-black"],
  ["brightBlue", "--terminal-bright-blue"],
  ["brightCyan", "--terminal-bright-cyan"],
  ["brightGreen", "--terminal-bright-green"],
  ["brightMagenta", "--terminal-bright-magenta"],
  ["brightRed", "--terminal-bright-red"],
  ["brightWhite", "--terminal-bright-white"],
  ["brightYellow", "--terminal-bright-yellow"],
  ["cursor", "--terminal-cursor"],
  ["cursorAccent", "--terminal-cursor-accent"],
  ["cyan", "--terminal-cyan"],
  ["foreground", "--terminal-foreground"],
  ["green", "--terminal-green"],
  ["magenta", "--terminal-magenta"],
  ["red", "--terminal-red"],
  ["selectionBackground", "--terminal-selection-background"],
  ["selectionForeground", "--terminal-selection-foreground"],
  ["white", "--terminal-white"],
  ["yellow", "--terminal-yellow"],
];

function readCssVar(
  style: CSSStyleDeclaration | null,
  name: string,
): string | null {
  if (!style) return null;
  const value = style.getPropertyValue(name).trim();
  return value || null;
}

export function getXtermTheme(): ITheme {
  const style =
    typeof document === "undefined"
      ? null
      : window.getComputedStyle(document.documentElement);
  const theme: ITheme = {};
  for (const [key, cssVar] of theme_entries) {
    const value = readCssVar(style, cssVar);
    if (value) theme[key] = value;
  }
  return theme;
}
