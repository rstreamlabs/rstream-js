# Add WebTTY algorithms with browser support

Adding another WebTTY payload algorithm needs a browser WebCrypto support review as well as a Node implementation. Verify shared vectors with Go and C++, explicit negotiation and downgrade rejection before enabling a suite. Avoid introducing a browser cryptography dependency solely to make an unsupported algorithm selectable.
