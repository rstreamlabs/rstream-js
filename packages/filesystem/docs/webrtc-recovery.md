# Filesystem WebRTC restart qualification

A restart answer completes signaling; it does not prove that a new ICE path is
selected or that reliable SCTP data has resumed. Replacing that path again while
SCTP is still recovering can stall an otherwise valid download. Frequent-restart
qualification exposes this with the Pion maintenance candidate, reliably on the
native Node ARM64 provider and intermittently on x86_64.

The client keeps one renegotiation in flight, waits for actual selection, then
requires incoming transfer progress before rearming its restart interval.
Authorization renewal continues independently during both phases. A denied
renewal fails the public stream and closes its peer; recovery never grants an
extra authorization lease or enables HTTP data fallback.

An active, empty-queue read gets a 20-second recovery budget after path selection.
A consumer intentionally paused outside a read retains its bounded receive window
and authorization renewal. It does not receive an idle timeout merely because
it has not consumed buffered data. Completion, resumed data and owner cancellation
clear the recovery timer. Existing negotiation budgets and test deadlines are
unchanged.

## Provider contract

The factory must return a fresh peer owned exclusively by the transfer. During
restart it must expose the selected pair through standard transport stats, or
Firefox's documented selected-pair fallback. Nomination and a stale `connected`
state do not prove selection. A reselection counter also handles a pair whose
identifier is reused. Missing evidence fails explicitly within the negotiation
budget; no polling worker survives cancellation.

The standard transport statistic is available in Chromium 80+, Safari 13.1+ and
Firefox 153+; older Firefox uses its `candidate-pair.selected` statistic. See
[MDN's standard statistic](https://developer.mozilla.org/en-US/docs/Web/API/RTCTransportStats/selectedCandidatePairId)
and [Firefox's fallback](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidatePairStats/selected).
The existing native Node provider exposes the standard statistic. Its separate
macOS gathering limitation reproduces with both preceding and candidate Go
stacks; this change does not claim to fix native gathering.

## Validation and release coupling

Keep the actual 8 MiB TURN transfer, complete hash, real restart signaling and
30-second limit. Qualify Node x86_64/ARM64 with repeated transfers, short leases,
renewal denial, browser consumers, pause/cancellation and ordinary reads. A
library unit suite or one successful transfer is insufficient.

Consumers with embedded browser bundles must regenerate them from the same
qualified SDK source and retain its provenance. A source PR does not publish an
npm release or update already generated browser assets automatically. Coordinate
those dependency pins and generated assets before accepting the Pion release;
keep local candidate qualification separate from stable publication/deployment.
