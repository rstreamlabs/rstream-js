// See LICENSE file in the project root for license information.

export type Address = { ip: string } | { error: string };

export type IpResult = { ipv4?: Address; ipv6?: Address } | { error: string };

const DEFAULT_STUN = "stun:stun.l.google.com:19302";

/**
 * Gather public IPv4 / IPv6 addresses using RTCPeerConnection.
 *
 * @param stunServer By default "stun:stun.l.google.com:19302"
 * @returns IpResult, containing:
 *   - { ipv4?: { ip: string } | { error: string }, ipv6?: ..., }
 *       OR
 *   - { error: string } if we failed to get addresses
 */
export async function getPublicIP(
  stunServer: string = DEFAULT_STUN,
): Promise<IpResult> {
  const errors: string[] = [];
  const result: { ipv4?: Address; ipv6?: Address } = {};
  try {
    const configuration: RTCConfiguration = {
      iceServers: [{ urls: stunServer }],
    };
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === "srflx") {
        const address = event.candidate.address;
        if (address) {
          if (address.includes(":")) {
            result.ipv6 = { ip: address };
          } else {
            result.ipv4 = { ip: address };
          }
        }
      }
    };
    peerConnection.onicecandidateerror = (event) => {
      errors.push(`${event.errorText} (error code ${event.errorCode})`);
    };
    peerConnection.createDataChannel(`datachannel-${Math.random()}`);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        errors.push("Timed out waiting for ICE candidates.");
        resolve();
      }, 30000);
      peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
    peerConnection.close();
    const haveIPv4 = !!result.ipv4;
    const haveIPv6 = !!result.ipv6;
    if (!haveIPv4 && !haveIPv6) {
      return {
        error:
          errors.length > 0
            ? errors[0]!
            : "Failed to get IP addresses. (No srflx candidates found.)",
      };
    }
    return {
      ipv4:
        result.ipv4 || (errors.length > 0 ? { error: errors[0]! } : undefined),
      ipv6:
        result.ipv6 || (errors.length > 0 ? { error: errors[0]! } : undefined),
    };
  } catch (err: any) {
    return { error: `Connection failed: ${err.message}` };
  }
}
