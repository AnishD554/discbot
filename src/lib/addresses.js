import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { HDNodeWallet } from "ethers";
import * as ecc from "tiny-secp256k1";
import TronWeb from "tronweb";

bitcoin.initEccLib(ecc);

function bitcoinNetwork(method) {
  return method.bitcoinNetwork === "testnet"
    ? bitcoin.networks.testnet
    : bitcoin.networks.bitcoin;
}

function deriveEvmAddress(mnemonic, derivationPath, index) {
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, `${derivationPath}/${index}`);
  return {
    address: wallet.address
  };
}

function deriveBitcoinAddress(mnemonic, derivationPath, index, method) {
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, `${derivationPath}/${index}`);
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(wallet.publicKey.slice(2), "hex"),
    network: bitcoinNetwork(method)
  });

  return {
    address: payment.address
  };
}

function deriveTronAddress(mnemonic, derivationPath, index) {
  const wallet = TronWeb.fromMnemonic(mnemonic, `${derivationPath}/${index}`);
  return {
    address: wallet.address,
    privateKey: wallet.privateKey
  };
}

function deriveSolanaTarget(mnemonic, derivationPath, index, method) {
  const seed = mnemonicToSeedSync(mnemonic);
  const derived = derivePath(`${derivationPath}/${index}'`, seed.toString("hex"));
  const keypair = Keypair.fromSeed(derived.key.slice(0, 32));
  const ownerAddress = keypair.publicKey.toBase58();

  if (method.watcherType === "solana_spl") {
    const tokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(method.tokenMint),
      keypair.publicKey
    );
    return {
      address: tokenAccount.toBase58(),
      ownerAddress
    };
  }

  return {
    address: ownerAddress,
    ownerAddress
  };
}

export function resolveInvoiceTarget(mnemonic, method, derivationIndex) {
  if ((method.addressSource ?? "fixed") === "fixed") {
    if (method.watcherType === "solana_spl") {
      const owner = new PublicKey(method.address);
      const tokenAccount = getAssociatedTokenAddressSync(
        new PublicKey(method.tokenMint),
        owner
      );

      return {
        address: tokenAccount.toBase58(),
        ownerAddress: owner.toBase58()
      };
    }

    return {
      address: method.address
    };
  }

  switch (method.keyScheme) {
    case "evm":
      return deriveEvmAddress(mnemonic, method.derivationPath, derivationIndex);
    case "bitcoin":
      return deriveBitcoinAddress(mnemonic, method.derivationPath, derivationIndex, method);
    case "tron":
      return deriveTronAddress(mnemonic, method.derivationPath, derivationIndex);
    case "solana":
      return deriveSolanaTarget(mnemonic, method.derivationPath, derivationIndex, method);
    default:
      throw new Error(`Unsupported keyScheme "${method.keyScheme}" for ${method.id}`);
  }
}
