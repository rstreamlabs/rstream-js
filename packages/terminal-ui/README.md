# Shared terminal UI

`@rstreamlabs/terminal-ui` provides a tabbed WebTTY workspace, an xterm surface,
and the rstream encryption indicator for React applications.

`WebTTYWorkspace` owns tabs, connection status and terminal cleanup. Supply a
`prepareSession` function that obtains a fresh authorized connection for each
new terminal, plus the application's `Button` component. Keep this callback
stable with `useCallback`. It receives an `AbortSignal`: pass it to authorization
requests so unmounting or changing permissions cancels the work. Late results are
discarded even if the provider cannot cancel. Concurrent clicks prepare one tab
at a time; existing sessions remain mounted when switching tabs. Keep authorization on
the application backend: the workspace does not store a long-lived credential
or mint tokens itself. A fixed shared connection can instead return its existing
URL; its authorization still expires according to the issuer's policy.

`TerminalFrame` is controlled: its host owns tabs and active selection and supplies
`renderTab`, optional fullscreen navigation and a security badge. Up to five tabs
can be opened. Switching tabs keeps inactive panels mounted.

`TerminalSurface` owns xterm, addons, sizing and theme changes. A transport adapter
owns input/output and session completion. It must disable input when a session
closes, stop readers on unmount and never replay terminal input.

Import `@xterm/xterm/css/xterm.css` and `@rstreamlabs/terminal-ui/theme.css` once in
the host. Tailwind consumers must scan the package's `dist` directory with an
`@source` directive. The palette reads the host's `--background` token.

`TerminalCryptoBadge` displays verified public session metadata. Transport-only
sessions do not display an end-to-end encryption badge. Do not pass keys or
credentials to the badge.

Build with `npm run build --workspace @rstreamlabs/terminal-ui`. Release candidates
are packaged and verified by the repository's npm release workflow before stable
publication.
