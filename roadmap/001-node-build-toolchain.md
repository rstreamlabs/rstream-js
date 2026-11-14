# Align the Node.js build-toolchain baseline

The private workspace declares Node 18, while some tooling and transitive type
packages declare Node 20. Choose and test a coherent contributor toolchain before
adopting tsup 9, which requires Node 22.18 or newer. Qualify published SDK runtime
compatibility separately from the development test harness and build tools.
