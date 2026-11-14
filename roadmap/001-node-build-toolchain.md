# Align the contributor Node requirement

Repository checks run on Node 24, while the root manifest still accepts Node 18 and some development dependencies require newer runtimes. Align the declared contributor requirement with the tested toolchain before upgrading the bundler. tsup 9 requires Node 22.18 or newer.

Keep published SDK runtime compatibility separate from contributor tools and their test harness. The declared contributor minimum must pass a normal dependency installation and the supported check commands.
