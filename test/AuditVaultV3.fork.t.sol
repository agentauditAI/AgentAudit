// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {AuditVaultV3} from "../contracts/v3/AuditVaultV3.sol";

/// @notice The canonical ERC-8004 IdentityRegistry functions used by the fork tests
///         (docs/design/AUDITVAULT_V3.md §2.1, copied from the verified source).
interface IForkIdentityRegistry {
    function register() external returns (uint256 agentId);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function name() external view returns (string memory);
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

/// @notice Fork tests of AuditVault v3 against the real canonical ERC-8004 IdentityRegistry on Base and
///         Celo (design doc §12, "Fork (Base, Celo)"): register an agent, commit, transfer, commit as the
///         new owner, set a wallet, commit as the wallet. Nothing is broadcast; the fork is local.
/// @dev Skipped unless an RPC URL is set, so CI without network access stays green:
///      BASE_RPC_URL=… CELO_RPC_URL=… forge test --match-path test/AuditVaultV3.fork.t.sol -vvv
contract AuditVaultV3ForkTest is Test {
    // ─── Constants ───

    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    /// @dev ERC-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1).
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    /// @dev Implementation and runtime code hash recorded on 2026-10-31 (design doc §2.1). A mismatch means
    ///      the registry was upgraded: re-review §2 before deploying v3.
    address constant PINNED_IMPLEMENTATION = 0x7274e874CA62410a93Bd8bf61c69d8045E399c02;
    bytes32 constant PINNED_IMPLEMENTATION_SHA256 = 0x201b7634af2de088c58868052856922ea8534c47e2837f19529460e2fafb4ff1;
    bytes32 constant AGENT_WALLET_SET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // ─── Actors ───

    address alice;
    uint256 aliceKey;
    address bob;
    uint256 bobKey;
    address carol;
    uint256 carolKey;
    address stranger;
    uint256 strangerKey;
    address relayer = makeAddr("relayer");

    IForkIdentityRegistry registry = IForkIdentityRegistry(REGISTRY);
    AuditVaultV3 vault;

    // ─── Helpers ───

    /// @dev Selects a fork from `envName`; returns false (and skips) when the variable is unset.
    function _fork(string memory envName) internal returns (bool) {
        string memory url = vm.envOr(envName, string(""));
        if (bytes(url).length == 0) {
            vm.skip(true, string.concat(envName, " not set"));
            return false;
        }
        vm.createSelectFork(url);
        (alice, aliceKey) = makeAddrAndKey("fork-alice");
        (bob, bobKey) = makeAddrAndKey("fork-bob");
        (carol, carolKey) = makeAddrAndKey("fork-carol");
        (stranger, strangerKey) = makeAddrAndKey("fork-stranger");
        vault = new AuditVaultV3(REGISTRY);
        return true;
    }

    function _signDigest(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _next(uint256 id) internal view returns (AuditVaultV3.Batch memory b) {
        uint64 seq = vault.nextSeq(id);
        b = AuditVaultV3.Batch({
            identityRegistry: REGISTRY,
            agentId: id,
            seq: seq,
            prevBatchHash: seq == 0 ? bytes32(0) : vault.batchHashAt(id, seq - 1),
            root: keccak256(abi.encode("fork-root", id, seq)),
            leafCount: 3,
            rootFormat: 0,
            metaHash: keccak256(abi.encode("fork-meta", id, seq))
        });
    }

    function _commit(uint256 key, AuditVaultV3.Batch memory b) internal returns (bytes32 batchHash) {
        bytes memory sig = _signDigest(key, vault.hashBatch(b));
        vm.prank(relayer);
        batchHash = vault.commitBatch(b, sig, "ipfs://fork-batch");
    }

    function _expectInvalidSignature(address expectedSigner) internal {
        vm.expectRevert(abi.encodeWithSelector(AuditVaultV3.InvalidSignature.selector, expectedSigner));
    }

    /// @dev AgentWalletSet digest in the registry's own EIP-712 domain, read from `eip712Domain()`.
    function _walletSetDigest(uint256 id, address newWallet, address owner, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            registry.eip712Domain();
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract)
        );
        bytes32 structHash = keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, id, newWallet, owner, deadline));
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    /// @dev Registry is still the implementation checked in the design doc.
    function _checkRegistry() internal view {
        address impl = address(uint160(uint256(vm.load(REGISTRY, IMPLEMENTATION_SLOT))));
        assertEq(impl, PINNED_IMPLEMENTATION, "registry implementation changed: re-review design doc section 2");
        assertEq(sha256(impl.code), PINNED_IMPLEMENTATION_SHA256, "registry code changed: re-review design doc section 2");
        assertEq(registry.name(), "AgentIdentity");
    }

    /// @dev Register, commit, transfer, commit as the new owner, set a wallet, commit as the wallet.
    function _lifecycle() internal {
        _checkRegistry();

        // register() mints to the caller and starts the wallet as the caller.
        vm.prank(alice);
        uint256 id = registry.register();
        assertEq(registry.ownerOf(id), alice);
        assertEq(registry.getAgentWallet(id), alice);
        assertEq(vault.authorizedSigner(id), alice);

        // seq 0: signed by alice, relayed by someone else.
        bytes32 h0 = _commit(aliceKey, _next(id));
        (address signer0,,) = vault.batchRecord(h0);
        assertEq(signer0, alice);
        assertEq(vault.batchHashAt(id, 0), h0);

        // A stranger cannot sign for the agent.
        AuditVaultV3.Batch memory b1 = _next(id);
        bytes memory strangerSig = _signDigest(strangerKey, vault.hashBatch(b1));
        _expectInvalidSignature(alice);
        vault.commitBatch(b1, strangerSig, "");

        // Transfer clears agentWallet, so the new owner becomes the signer.
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        assertEq(registry.getAgentWallet(id), address(0));
        assertEq(vault.authorizedSigner(id), bob);

        // The previous owner can no longer sign; the chain continues under bob.
        bytes memory aliceSig = _signDigest(aliceKey, vault.hashBatch(b1));
        _expectInvalidSignature(bob);
        vault.commitBatch(b1, aliceSig, "");
        bytes32 h1 = _commit(bobKey, b1);
        (address signer1,,) = vault.batchRecord(h1);
        assertEq(signer1, bob);
        assertEq(_next(id).prevBatchHash, h1);

        // bob sets carol as the wallet through the registry; carol signs, bob no longer can.
        uint256 deadline = block.timestamp + 60;
        bytes memory walletSig = _signDigest(carolKey, _walletSetDigest(id, carol, bob, deadline));
        vm.prank(bob);
        registry.setAgentWallet(id, carol, deadline, walletSig);
        assertEq(registry.getAgentWallet(id), carol);
        assertEq(vault.authorizedSigner(id), carol);

        AuditVaultV3.Batch memory b2 = _next(id);
        bytes memory bobSig = _signDigest(bobKey, vault.hashBatch(b2));
        _expectInvalidSignature(carol);
        vault.commitBatch(b2, bobSig, "");
        bytes32 h2 = _commit(carolKey, b2);
        (address signer2,,) = vault.batchRecord(h2);
        assertEq(signer2, carol);
        assertEq(vault.nextSeq(id), 3);
    }

    function _unknownAgent() internal {
        uint256 id = type(uint256).max;
        vm.expectRevert(abi.encodeWithSelector(AuditVaultV3.UnknownAgent.selector, id));
        vault.authorizedSigner(id);
    }

    // ─── Base (8453) ───

    function test_fork_base_lifecycle() public {
        if (!_fork("BASE_RPC_URL")) return;
        assertEq(block.chainid, 8453);
        _lifecycle();
    }

    function test_fork_base_unknownAgentReverts() public {
        if (!_fork("BASE_RPC_URL")) return;
        _unknownAgent();
    }

    // ─── Celo (42220) ───

    function test_fork_celo_lifecycle() public {
        if (!_fork("CELO_RPC_URL")) return;
        assertEq(block.chainid, 42220);
        _lifecycle();
    }

    function test_fork_celo_unknownAgentReverts() public {
        if (!_fork("CELO_RPC_URL")) return;
        _unknownAgent();
    }
}
