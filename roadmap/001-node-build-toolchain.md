# Qualify the next Node build-tool upgrade

The private workspace now declares Node 24 or newer, matching the contributor
workflow. Published SDK runtime requirements remain separate from contributor
tools and test harnesses. Before upgrading the bundler, qualify its compiler,
lint and release consumers together; tsup 9 requires Node 22.18 or newer.
