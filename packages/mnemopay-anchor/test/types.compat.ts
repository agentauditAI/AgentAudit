// Compile-time only (checked by `tsc -p packages/mnemopay-anchor`): our local
// interface types must stay structurally identical to the upstream MnemoPay seam.

import type * as Upstream from "./vendor/anchor-sink";
import type * as Ours from "../src/index";
import type { AuditVaultAnchorSink } from "../src/index";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertTrue = <T extends true>(): T => true as T;

export const typeChecks = [
  assertTrue<Same<Ours.AnchorRequest, Upstream.AnchorRequest>>(),
  assertTrue<Same<Ours.AnchorHandle, Upstream.AnchorHandle>>(),
  assertTrue<Same<Ours.AnchorReference, Upstream.AnchorReference>>(),
  assertTrue<Same<Ours.AnchorStatus, Upstream.AnchorStatus>>(),
  assertTrue<Same<Ours.OnChainAnchorSink, Upstream.OnChainAnchorSink>>(),
];

// The concrete sink is injectable wherever MnemoPay expects its seam
export function asUpstreamSink(sink: AuditVaultAnchorSink): Upstream.OnChainAnchorSink {
  return sink;
}
