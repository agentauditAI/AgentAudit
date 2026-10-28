// Unit tests — no network. Every case here fails or returns before any RPC call.

import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { ethers } from "ethers";
import {
  AuditVaultAnchorSink,
  DEFAULT_NAMESPACE,
  anchorContentURI,
  eventCountFromMeta,
  hashProducerId,
  toBytes32Root,
  type AuditVaultAnchorSinkOptions,
} from "../src/index";

// Nothing listens here; only reached by the status() RPC-error test
const DEAD_RPC = "http://127.0.0.1:1";
const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ROOT = "fac91804e3e6fd9f9c25d9e0a68ae01b860dcb26e048cf31c32c63240a20803f";

const sinks: AuditVaultAnchorSink[] = [];

function makeSink(overrides: Partial<AuditVaultAnchorSinkOptions> = {}): AuditVaultAnchorSink {
  const sink = new AuditVaultAnchorSink({
    chain: "testchain",
    rpcUrl: DEAD_RPC,
    vaultAddress: VAULT,
    signer: ethers.Wallet.createRandom(),
    ...overrides,
  });
  sinks.push(sink);
  return sink;
}

afterAll(async () => {
  sinks.forEach((s) => s.destroy());
  // ethers' network-detection retry loop sleeps 1 s before it notices destroy()
  await new Promise((r) => setTimeout(r, 1100));
});

describe("AuditVaultAnchorSink constructor", () => {
  it("accepts the minimal options and applies defaults", () => {
    const sink = makeSink();
    expect(sink.chain).toBe("testchain");
    expect(sink.namespace).toBe(DEFAULT_NAMESPACE);
    expect(sink.namespace).toBe("mnemopay");
    expect(sink.confirmations).toBe(1);
    expect(sink.vaultAddress).toBe(VAULT);
  });

  it("checksums the vault address", () => {
    expect(makeSink({ vaultAddress: VAULT.toLowerCase() }).vaultAddress).toBe(VAULT);
  });

  it.each([
    ["chain", { chain: "" }, /chain is required/],
    ["rpcUrl", { rpcUrl: "" }, /rpcUrl is required/],
    ["vaultAddress", { vaultAddress: "0x1234" }, /vaultAddress must be a valid address/],
    ["signer", { signer: undefined as unknown as ethers.Signer }, /signer is required/],
    ["namespace empty", { namespace: "" }, /namespace must be non-empty/],
    ["namespace with colon", { namespace: "a:b" }, /must not contain ":"/],
    ["confirmations 0", { confirmations: 0 }, /confirmations must be an integer >= 1/],
    ["confirmations fractional", { confirmations: 1.5 }, /confirmations must be an integer >= 1/],
    ["statusTimeoutMs 0", { statusTimeoutMs: 0 }, /statusTimeoutMs must be an integer >= 1/],
  ])("rejects invalid %s", (_label, overrides, err) => {
    expect(() => makeSink(overrides as Partial<AuditVaultAnchorSinkOptions>)).toThrow(err);
  });

  it("rejects missing options entirely", () => {
    expect(() => new AuditVaultAnchorSink(undefined as unknown as AuditVaultAnchorSinkOptions)).toThrow(/chain is required/);
  });
});

describe("producerId hashing and contentURI", () => {
  it("hashes producerId with SHA-256 over UTF-8, lowercase hex", () => {
    expect(hashProducerId("mnemopay/fixture")).toBe("00c8b85b34678455e9fc985761528a85bb2b8d8bf536e3845e30399f84e5f261");
    expect(hashProducerId("ü")).toBe(ethers.sha256(ethers.toUtf8Bytes("ü")).slice(2));
  });

  it("builds <namespace>:<sha256(producerId)>:<sealedAt>", () => {
    expect(anchorContentURI("ns", "mnemopay/fixture", "2026-10-27T12:00:03.000Z")).toBe(
      "ns:00c8b85b34678455e9fc985761528a85bb2b8d8bf536e3845e30399f84e5f261:2026-10-27T12:00:03.000Z",
    );
  });

  it("never contains the producerId in plaintext", () => {
    const uri = anchorContentURI("mnemopay", "acme-corp/eu-prod", "2026-10-27T12:00:03.000Z");
    expect(uri).not.toContain("acme-corp");
    expect(uri.split(":")[1]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("toBytes32Root", () => {
  it("accepts bare, 0x-prefixed and uppercase hex", () => {
    expect(toBytes32Root(ROOT)).toBe("0x" + ROOT);
    expect(toBytes32Root("0x" + ROOT)).toBe("0x" + ROOT);
    expect(toBytes32Root(ROOT.toUpperCase())).toBe("0x" + ROOT);
  });

  it.each([
    ["empty", ""],
    ["short", ROOT.slice(2)],
    ["long", ROOT + "00"],
    ["non-hex", "z" + ROOT.slice(1)],
    ["0x only", "0x"],
    ["non-string", 42 as unknown as string],
  ])("rejects %s", (_label, root) => {
    expect(() => toBytes32Root(root)).toThrow(/32-byte hex string/);
  });

  it("rejects the zero root (AuditVault reverts on it)", () => {
    expect(() => toBytes32Root("0".repeat(64))).toThrow(/must not be zero/);
  });
});

describe("eventCountFromMeta", () => {
  it("uses a positive integer event_count", () => {
    expect(eventCountFromMeta({ event_count: 7 })).toBe(7);
  });

  it.each([
    ["missing meta", undefined],
    ["no event_count", {}],
    ["zero", { event_count: 0 }],
    ["negative", { event_count: -3 }],
    ["fractional", { event_count: 2.5 }],
    ["string", { event_count: "5" }],
    ["unsafe integer", { event_count: 2 ** 53 }],
  ])("falls back to 1 for %s", (_label, meta) => {
    expect(eventCountFromMeta(meta as Record<string, unknown> | undefined)).toBe(1);
  });
});

describe("anchor() input validation (before any RPC)", () => {
  const good = { producerId: "p", merkleRoot: ROOT, bundleMeta: {}, sealedAt: "2026-10-27T12:00:03.000Z" };

  it.each([
    ["empty producerId", { ...good, producerId: "" }, /producerId is required/],
    ["empty sealedAt", { ...good, sealedAt: "" }, /sealedAt is required/],
    ["empty merkleRoot", { ...good, merkleRoot: "" }, /32-byte hex string/],
    ["zero merkleRoot", { ...good, merkleRoot: "0".repeat(64) }, /must not be zero/],
  ])("rejects %s", async (_label, input, err) => {
    await expect(makeSink().anchor(input)).rejects.toThrow(err);
  });

  it("rejects a missing request", async () => {
    await expect(makeSink().anchor(undefined as never)).rejects.toThrow(/producerId is required/);
  });
});

describe("status()", () => {
  it.each([["not hex", "mock-anchor-1"], ["short hash", "0x1234"], ["empty", ""], ["non-string", 7 as unknown as string]])(
    "returns failed for a malformed anchorId (%s) without throwing",
    async (_label, id) => {
      const status = await makeSink().status(id);
      expect(status.state).toBe("failed");
      if (status.state === "failed") expect(status.reason).toMatch(/unknown anchorId/);
    },
  );

  it("returns pending, not failed, when the RPC refuses connections, and records the error", async () => {
    const sink = makeSink();
    const status = await sink.status("0x" + "ab".repeat(32));
    expect(status).toEqual({ state: "pending" });
    expect(sink.lastStatusError).toMatch(/ECONNREFUSED/);
  });

  describe("against an RPC that never answers", () => {
    let server: Server;
    let rpcUrl: string;

    beforeAll(async () => {
      server = createServer(() => undefined);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    });

    it("times out to pending after statusTimeoutMs and records the timeout", async () => {
      const sink = makeSink({ rpcUrl, statusTimeoutMs: 200 });
      const status = await sink.status("0x" + "ab".repeat(32));
      expect(status).toEqual({ state: "pending" });
      expect(sink.lastStatusError).toBe("timed out after 200 ms");
    });
  });
});
