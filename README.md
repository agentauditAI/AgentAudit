# AgentAudit

> On-chain EU AI Act compliance infrastructure for autonomous AI agents —
> the audit, registration, and incident-reporting layer for ERC-8004.

AgentAudit supports Art. 12 (record-keeping) and Art. 19 (log retention) evidence:
agents log automatically, and a Merkle root of each batch is anchored on-chain so
anyone can later check that the logs were not changed after anchoring. The
on-chain anchor is a verification aid, not something the Act itself requires.

## Verify it yourself

The first AuditVault v2 batch on Base mainnet:
[`0xf5e494b9…dc14ba`](https://basescan.org/tx/0xf5e494b922794a1a718024220c79ad8742eb248d15c5c219bb1fceea43dc14ba).
Its evidence bundle is [`docs/demo/first-anchor-bundle.json`](docs/demo/first-anchor-bundle.json).
Re-check it with the standalone verifier ([`tools/verify/`](tools/verify/README.md),
depends only on `ethers`):

```bash
npm install
npx tsc -p tools/verify/tsconfig.build.json
node tools/verify/dist/cli.js docs/demo/first-anchor-bundle.json --rpc https://mainnet.base.org
# … RESULT  PASS  14/14 checks passed
```

The verifier recomputes every `action_ref` and the Merkle root from the bundle,
then checks the `LogBatchCommitted` event and `verifyLog` for each entry on-chain.

## Deployed Networks

**Batch logging (AuditVault v2 `commitBatch`) is live on Base mainnet only.**
Incident reporting (IncidentRegistry v2, Art. 73) is live on 5 mainnets: Base,
Arbitrum One, Optimism, Polygon and Mantle.

### Production (Mainnet)

| Network | Contract | Address | Chain ID |
|---|---|---|---|
| Mantle Mainnet | AuditVault v1 | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | 5000 |
| Base | AuditVault v2 | `0xCeE831070aa9081422f30df5559c125aa47A75DB` | 8453 |
| Arbitrum One | AuditVault (not v2 — no `commitBatch`; source not in this repo) | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | 42161 |
| Optimism | AuditVault (not v2 — no `commitBatch`; source not in this repo) | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | 10 |
| Polygon | AuditVault (not v2 — no `commitBatch`; source not in this repo) | `0x6fC00423Df95a7caf6fFFDD93169b5C01480de02` | 137 |

Only the Base and Robinhood Testnet contracts are AuditVault v2 (`contracts/v2/AuditVault.sol`) and
support SDK batch anchoring. The Arbitrum/Optimism/Polygon contract shares some v2 read functions but has
no `commitBatch(address,bytes32,string,uint256,uint8)`; see `sdk/README.md` → Supported Networks.

| Network | IncidentRegistry v2 (Art. 73) |
|---|---|
| Base, Arbitrum One, Polygon, Mantle | `0x6ad45a9B32e695e95492dC3796a5aC8543B2EA6F` |
| Optimism | `0x976b03a2417cf7926813605F427ED499fdF61e10` |

### Testnet

| Network | Contract | Address | Chain ID |
|---|---|---|---|
| Robinhood Chain Testnet | AuditVault v2 | `0x6B5BebC2f9172c6E17Df5ea59C1753D360866bDB` | 46630 |

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
