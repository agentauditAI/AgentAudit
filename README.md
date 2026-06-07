# AgentAudit

> On-chain EU AI Act compliance infrastructure for autonomous AI agents —
> the audit, registration, and incident-reporting layer for ERC-8004.

## Deployed Networks

### Production (Mainnet)

| Network | Contract | Address | Chain ID |
|---|---|---|---|
| Mantle Mainnet | AuditVault v1 | `0xD0086f19eDb500fB9d3382f6f5EAE1C015be054b` | 5000 |
| Base | AuditVault v2 | `0xCeE831070aa9081422f30df5559c125aa47A75DB` | 8453 |
| Arbitrum One | AuditVault v2 | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | 42161 |
| Optimism | AuditVault v2 | `0x30579c6bFe4401A4b07062f0cc13C08FF2D9450C` | 10 |
| Polygon | AuditVault v2 | `0x6fC00423Df95a7caf6fFFDD93169b5C01480de02` | 137 |

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
