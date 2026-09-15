/**
 * FUTURE WORK — not wired, do not call from product flows.
 *
 * Commercial DocuSign / e-sign SaaS envelope APIs are intentionally absent.
 * PDF Relief E-Sign is local-first: files stay on the device. This module is
 * the single place a later remote-envelope experiment should land so vendor
 * calls are not scattered through the workshop.
 *
 * Do not brand any UI as DocuSign. Product name: E-Sign / Sign in PDF Relief.
 */
import type { Signer } from "./esign";

export type RemoteEnvelopeRequest = {
  sourceFileName: string;
  signers: Signer[];
};

export async function sendRemoteEnvelope(_request: RemoteEnvelopeRequest): Promise<never> {
  throw new Error(
    "Remote envelope sending is not available. PDF Relief E-Sign stays on this device.",
  );
}
