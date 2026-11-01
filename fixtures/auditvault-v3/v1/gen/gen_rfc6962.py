#!/usr/bin/env python3
"""Generate fixtures/auditvault-v3/v1/rfc6962.json.

An independent RFC 6962 §2.1 / §2.1.1 implementation (Python standard library only,
``hashlib.sha256``). It does not share code or algorithm with the Solidity contract:
roots use the recursive MTH definition and inclusion proofs use the recursive PATH
definition, while the contract verifies with the iterative RFC 9162 §2.1.3.2 loop.

Usage:
    python3 gen_rfc6962.py           # (re)write ../rfc6962.json
    python3 gen_rfc6962.py --check   # regenerate in memory, exit 1 unless the file matches byte for byte
"""

import hashlib
import json
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rfc6962.json")


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def leaf_hash(d: bytes) -> bytes:
    return sha256(b"\x00" + d)


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(b"\x01" + left + right)


def split(n: int) -> int:
    """Largest power of two strictly smaller than n (n > 1)."""
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def mth(d):
    """RFC 6962 §2.1 Merkle Tree Hash. MTH({}) is not allowed in AuditVault v3."""
    n = len(d)
    assert n >= 1
    if n == 1:
        return leaf_hash(d[0])
    k = split(n)
    return node_hash(mth(d[:k]), mth(d[k:]))


def path(m: int, d):
    """RFC 6962 §2.1.1 audit path PATH(m, D[n]), leaf-to-root order."""
    n = len(d)
    if n == 1:
        return []
    k = split(n)
    if m < k:
        return path(m, d[:k]) + [mth(d[k:])]
    return path(m - k, d[k:]) + [mth(d[:k])]


def internal_nodes(d, start=0):
    """Every internal node (subtree of size >= 2) as (start, end, hash)."""
    n = len(d)
    if n == 1:
        return []
    k = split(n)
    return (
        [(start, start + n, mth(d))]
        + internal_nodes(d[:k], start)
        + internal_nodes(d[k:], start + k)
    )


def node_path(d, start, end, base=0):
    """Audit path from the subtree D[start:end] up to the root (the node's 'shorter path')."""
    n = len(d)
    if start == base and end == base + n:
        return []
    k = split(n)
    if end <= base + k:
        return node_path(d[:k], start, end, base) + [mth(d[k:])]
    return node_path(d[k:], start, end, base + k) + [mth(d[:k])]


def hx(b: bytes) -> str:
    return "0x" + b.hex()


def small_tree(n: int):
    leaves = [bytes([i]) * 32 for i in range(1, n + 1)]
    return {
        "n": n,
        "leaves": [hx(x) for x in leaves],
        "root": hx(mth(leaves)),
        "proofs": [[hx(p) for p in path(i, leaves)] for i in range(n)],
        "nodes": [
            {
                "start": s,
                "end": e,
                "hash": hx(h),
                "path": [hx(p) for p in node_path(leaves, s, e)],
            }
            for (s, e, h) in internal_nodes(leaves)
        ],
    }


def large_tree():
    n = 1000
    leaves = [sha256(i.to_bytes(4, "big")) for i in range(n)]
    samples = [0, 1, 2, 255, 256, 511, 512, 513, 767, 768, 991, 992, 998, 999]
    return {
        "n": n,
        "leaf_rule": "leaf_i = sha256(uint32_be(i)), i = 0..999",
        "root": hx(mth(leaves)),
        "samples": [
            {"index": i, "leaf": hx(leaves[i]), "proof": [hx(p) for p in path(i, leaves)]}
            for i in samples
        ],
    }


def build():
    evidence_ref = bytes.fromhex("42de5ecdb20e72e6f038c44c911870aac6200bb67db331b253bc8b794d5ffdad")
    doc = {
        "fixture": "auditvault-v3/v1/rfc6962",
        "tree": "rfc6962-sha256",
        "leaf_hash": "sha256(0x00 || action_ref)",
        "node_hash": "sha256(0x01 || left || right)",
        "split": "largest power of two < n",
        "proof_order": "leaf to root (RFC 6962 2.1.1 PATH)",
        "generator": "gen/gen_rfc6962.py (Python hashlib, independent of the Solidity implementation)",
        "small_leaf_rule": "leaf_i = bytes([i]) * 32, i = 1..n (design doc 5.2)",
        "trees": [small_tree(n) for n in range(1, 18)],
        "large": large_tree(),
        "evidence_schema_single_leaf": {
            "source": "docs/EVIDENCE_SCHEMA.md 1.2 action_ref",
            "action_ref": hx(evidence_ref),
            "root": hx(mth([evidence_ref])),
        },
    }
    return json.dumps(doc, indent=2) + "\n"


def main():
    text = build()
    if "--check" in sys.argv[1:]:
        with open(OUT, encoding="utf-8") as f:
            if f.read() != text:
                print("rfc6962.json does not match the generator output", file=sys.stderr)
                sys.exit(1)
        print("rfc6962.json matches")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", os.path.relpath(OUT))


if __name__ == "__main__":
    main()
