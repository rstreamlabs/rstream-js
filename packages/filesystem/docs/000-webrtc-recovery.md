# WebRTC transfer recovery

ICE restart changes the peer's network path during a transfer. Signaling,
selected-path confirmation and renewed data flow are separate stages; the
client waits for each before scheduling another restart.

The client keeps one renegotiation in flight, waits for actual selection, then
requires incoming transfer progress before rearming its restart interval.
Authorization renewal continues independently during both phases. A denied
renewal fails the public stream and closes its peer; recovery never grants an
extra authorization lease or enables HTTP data fallback.

An active, empty-queue read gets a 20-second recovery budget after path selection.
A consumer intentionally paused outside a read retains its bounded receive window
and authorization renewal. It does not receive an idle timeout merely because
it has not consumed buffered data. Completion, resumed data and owner cancellation
clear the recovery timer. Negotiation and transfer recovery use separate deadlines.

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
The native Node provider exposes the standard statistic. Qualify its gathering
behavior on the target platform separately from transfer recovery.

## Develop the transport

Keep the actual 8 MiB TURN transfer, complete hash, real restart signaling and
30-second limit. Qualify Node x86_64/ARM64 with repeated transfers, short leases,
renewal denial, browser consumers, pause/cancellation and ordinary reads. Exercise both ordinary transfers and recovery/failure paths.

Applications embedding browser bundles must rebuild them from the selected SDK
source when updating that dependency. Maintainers should qualify the server,
Node provider and browser bundle together, including the selected Pion graph.
