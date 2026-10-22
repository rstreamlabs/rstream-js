# Shared dashboard terminal UI

The rstream and dronectl dashboards use this package for the terminal frame,
mounted tab panels, xterm lifecycle, resizing and theme colours. It contains no
credentials, product API calls, robot discovery or execution-command history.

`TerminalFrame` is controlled: its host owns tabs, active selection and connection
status. Supply the host's shadcn `Button`, transport adapter via `renderTab`, and
optional fullscreen action and security badge. Up to five tabs can be opened.
Closing a tab removes its panel; switching tabs keeps every panel mounted.

`TerminalSurface` owns xterm and its addons. The host adapter owns input/output,
authorization, session cancellation and completion. It must disable input when a
session closes, abort readers on unmount and never replay terminal input.
Changing the document theme updates the existing display without reconnecting.

Import `@xterm/xterm/css/xterm.css` and `@rstreamlabs/terminal-ui/theme.css` once in
the host. Tailwind consumers must scan this package's `dist` directory with an
`@source` directive. The palette reads the host's `--background` token.

Build with `npm run build --workspace @rstreamlabs/terminal-ui` and package with
`npm pack --workspace @rstreamlabs/terminal-ui`. Until this preview is released,
both dashboards pin the same checked-in npm archive under `vendor/`, with its
integrity recorded in their lockfiles. Sources live here only; regenerate both
archives together. Do not edit either installed or archived copy.
