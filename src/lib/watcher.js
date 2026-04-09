import TronWeb from "tronweb";
import { Connection, PublicKey } from "@solana/web3.js";
import { Interface, JsonRpcProvider, formatUnits } from "ethers";

const erc20Interface = new Interface([
  "function balanceOf(address account) view returns (uint256)"
]);

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export class PaymentWatcher {
  constructor({ config, store, onInvoicePaid }) {
    this.config = config;
    this.store = store;
    this.onInvoicePaid = onInvoicePaid;
    this.evmProviders = new Map();
    this.solConnections = new Map();
    this.tronClients = new Map();
    this.timer = null;
    this.running = false;
  }

  getMethodConfig(methodId) {
    return this.config.paymentMethods.find((entry) => entry.id === methodId) ?? null;
  }

  getEvmProvider(rpcUrl) {
    if (!this.evmProviders.has(rpcUrl)) {
      this.evmProviders.set(
        rpcUrl,
        new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false })
      );
    }
    return this.evmProviders.get(rpcUrl);
  }

  getSolanaConnection(rpcUrl) {
    if (!this.solConnections.has(rpcUrl)) {
      this.solConnections.set(rpcUrl, new Connection(rpcUrl, "confirmed"));
    }
    return this.solConnections.get(rpcUrl);
  }

  getTronClient(fullHost) {
    if (!this.tronClients.has(fullHost)) {
      this.tronClients.set(fullHost, new TronWeb({ fullHost }));
    }
    return this.tronClients.get(fullHost);
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("Watcher tick failed:", error);
      });
    }, this.config.watchIntervalMs);

    this.tick().catch((error) => {
      console.error("Initial watcher tick failed:", error);
    });
  }

  async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const invoices = this.store.getPendingInvoices();
      for (const invoice of invoices) {
        const method = invoice.methods.find((entry) => entry.id === invoice.selectedMethodId);
        if (!method) {
          continue;
        }

        const methodConfig = this.getMethodConfig(method.methodId);
        if (!methodConfig) {
          continue;
        }

        if (method.baselineCurrentAtomic === null || method.baselineConfirmedAtomic === null) {
          continue;
        }

        const result = await this.checkMethod(method, methodConfig).catch((error) => {
          console.error(`Watcher failed for ${invoice.id}/${method.id}:`, error);
          return null;
        });

        if (!result) {
          continue;
        }

        const updated = this.store.updateInvoice(invoice.id, (draft) => {
          const target = draft.methods.find((entry) => entry.id === method.id);
          if (!target) {
            return draft;
          }

          target.status = result.status;
          target.receivedAtomic = result.receivedAtomic;
          target.receivedDisplayAmount = result.receivedDisplayAmount;
          target.detectedTxHash = result.txHash ?? target.detectedTxHash;
          target.paidAt = result.status === "paid" ? nowIso() : target.paidAt;
          draft.selectedMethodId = target.id;
          draft.status = result.status === "paid" ? "paid" : "pending";
          draft.updatedAt = nowIso();
          return draft;
        });

        if (updated?.status === "paid" && !this.store.hasPaidRecord(updated.id)) {
          this.store.recordPaidUser({
            invoiceId: updated.id,
            userId: updated.userId,
            username: updated.username,
            guildId: updated.guildId,
            usdAmount: updated.usdAmount,
            exam: updated.exam,
            paidAt: updated.updatedAt,
            method: method.paymentTitle,
            txHash: result.txHash ?? null
          });
        }

        if (updated?.status === "paid") {
          await this.onInvoicePaid(updated);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async checkMethod(method, methodConfig) {
    const expectedAtomic = BigInt(method.expectedAtomic);
    const minAtomic = BigInt(method.minAtomic ?? method.expectedAtomic);
    const baselineCurrent = BigInt(method.baselineCurrentAtomic ?? "0");
    const baselineConfirmed = BigInt(method.baselineConfirmedAtomic ?? "0");

    switch (methodConfig.watcherType) {
      case "manual":
        return null;
      case "evm_native":
        return this.checkEvmNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "evm_erc20":
        return this.checkEvmErc20(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "solana_native":
        return this.checkSolanaNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "solana_spl":
        return this.checkSolanaSpl(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "tron_native":
        return this.checkTronNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "tron_trc20":
        return this.checkTronTrc20(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "bitcoin_api":
        return this.checkBitcoin(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      case "sui_native":
        return this.checkSuiNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed);
      default:
        return null;
    }
  }

  async initializeSelectedMethod(invoiceId, methodId) {
    const invoice = this.store.getInvoice(invoiceId);
    if (!invoice) {
      return null;
    }

    const method = invoice.methods.find((entry) => entry.methodId === methodId);
    if (!method) {
      return invoice;
    }

    const methodConfig = this.getMethodConfig(method.methodId);
    if (!methodConfig) {
      return invoice;
    }

    const snapshot = await this.readBalances(method, methodConfig);
    return this.store.updateInvoice(invoiceId, (draft) => {
      const target = draft.methods.find((entry) => entry.methodId === methodId);
      if (!target) {
        return draft;
      }

      target.baselineCurrentAtomic = snapshot.currentAtomic;
      target.baselineConfirmedAtomic = snapshot.confirmedAtomic;
      target.status = "pending";
      target.receivedAtomic = null;
      target.receivedDisplayAmount = null;
      target.detectedTxHash = null;
      draft.selectedMethodId = target.id;
      draft.updatedAt = nowIso();
      return draft;
    });
  }

  async readBalances(method, methodConfig) {
    switch (methodConfig.watcherType) {
      case "manual":
        return { currentAtomic: "0", confirmedAtomic: "0", txHash: null };
      case "evm_native":
        return this.readEvmNativeBalances(method, methodConfig);
      case "evm_erc20":
        return this.readEvmErc20Balances(method, methodConfig);
      case "solana_native":
        return this.readSolanaNativeBalances(method, methodConfig);
      case "solana_spl":
        return this.readSolanaSplBalances(method, methodConfig);
      case "tron_native":
        return this.readTronNativeBalances(method, methodConfig);
      case "tron_trc20":
        return this.readTronTrc20Balances(method, methodConfig);
      case "bitcoin_api":
        return this.readBitcoinBalances(method, methodConfig);
      case "sui_native":
        return this.readSuiNativeBalances(method, methodConfig);
      default:
        return { currentAtomic: "0", confirmedAtomic: "0", txHash: null };
    }
  }

  async checkEvmNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readEvmNativeBalances(method, methodConfig);
    const latestBalance = BigInt(snapshot.currentAtomic);
    const confirmedBalance = BigInt(snapshot.confirmedAtomic);
    const currentDelta = latestBalance - baselineCurrent;
    const confirmedDelta = confirmedBalance - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readEvmNativeBalances(method, methodConfig) {
    const provider = this.getEvmProvider(methodConfig.rpcUrl);
    const latestBlock = await provider.getBlockNumber();
    const confirmedBlock = latestBlock - Number(methodConfig.confirmations) + 1;
    const latestBalance = await provider.getBalance(method.address);
    const confirmedBalance =
      confirmedBlock >= 0 ? await provider.getBalance(method.address, confirmedBlock) : 0n;

    return {
      currentAtomic: latestBalance.toString(),
      confirmedAtomic: confirmedBalance.toString(),
      txHash: null
    };
  }

  async checkEvmErc20(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readEvmErc20Balances(method, methodConfig);
    const latestBalance = BigInt(snapshot.currentAtomic);
    const confirmedBalance = BigInt(snapshot.confirmedAtomic);
    const currentDelta = latestBalance - baselineCurrent;
    const confirmedDelta = confirmedBalance - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readEvmErc20Balances(method, methodConfig) {
    const provider = this.getEvmProvider(methodConfig.rpcUrl);
    const latestBlock = await provider.getBlockNumber();
    const confirmedBlock = latestBlock - Number(methodConfig.confirmations) + 1;
    const data = erc20Interface.encodeFunctionData("balanceOf", [method.address]);

    const latestRaw = await provider.call({ to: methodConfig.tokenContract, data });
    const latestBalance = BigInt(latestRaw);
    const confirmedBalance =
      confirmedBlock >= 0
        ? BigInt(await provider.call({ to: methodConfig.tokenContract, data }, confirmedBlock))
        : 0n;

    return {
      currentAtomic: latestBalance.toString(),
      confirmedAtomic: confirmedBalance.toString(),
      txHash: null
    };
  }

  async checkSolanaNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readSolanaNativeBalances(method, methodConfig);
    const confirmed = BigInt(snapshot.currentAtomic);
    const finalized = BigInt(snapshot.confirmedAtomic);
    const currentDelta = confirmed - baselineCurrent;
    const confirmedDelta = finalized - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readSolanaNativeBalances(method, methodConfig) {
    const connection = this.getSolanaConnection(methodConfig.rpcUrl);
    const address = new PublicKey(method.address);
    const confirmed = BigInt(await connection.getBalance(address, "confirmed"));
    const finalized = BigInt(await connection.getBalance(address, "finalized"));

    return {
      currentAtomic: confirmed.toString(),
      confirmedAtomic: finalized.toString(),
      txHash: null
    };
  }

  async checkSolanaSpl(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readSolanaSplBalances(method, methodConfig);
    const confirmed = BigInt(snapshot.currentAtomic);
    const finalized = BigInt(snapshot.confirmedAtomic);
    const currentDelta = confirmed - baselineCurrent;
    const confirmedDelta = finalized - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readSolanaSplBalances(method, methodConfig) {
    const connection = this.getSolanaConnection(methodConfig.rpcUrl);
    const address = new PublicKey(method.address);

    const readAmount = async (commitment) => {
      try {
        const result = await connection.getTokenAccountBalance(address, commitment);
        return BigInt(result.value.amount);
      } catch {
        return 0n;
      }
    };

    const confirmed = await readAmount("confirmed");
    const finalized = await readAmount("finalized");

    return {
      currentAtomic: confirmed.toString(),
      confirmedAtomic: finalized.toString(),
      txHash: null
    };
  }

  async checkTronNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readTronNativeBalances(method, methodConfig);
    const current = BigInt(snapshot.currentAtomic);
    const confirmed = BigInt(snapshot.confirmedAtomic);
    const currentDelta = current - baselineCurrent;
    const confirmedDelta = confirmed - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readTronNativeBalances(method, methodConfig) {
    const tronWeb = this.getTronClient(methodConfig.fullHost);
    const confirmed = BigInt(await tronWeb.trx.getBalance(method.address));
    const unconfirmed = BigInt(await tronWeb.trx.getUnconfirmedBalance(method.address));

    return {
      currentAtomic: unconfirmed.toString(),
      confirmedAtomic: confirmed.toString(),
      txHash: null
    };
  }

  async checkTronTrc20(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readTronTrc20Balances(method, methodConfig);
    const current = BigInt(snapshot.currentAtomic);
    const confirmed = BigInt(snapshot.confirmedAtomic);
    const currentDelta = current - baselineCurrent;
    const confirmedDelta = confirmed - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readTronTrc20Balances(method, methodConfig) {
    const tronWeb = this.getTronClient(methodConfig.fullHost);
    const abi = [
      {
        outputs: [{ type: "uint256" }],
        constant: true,
        inputs: [{ name: "who", type: "address" }],
        name: "balanceOf",
        stateMutability: "View",
        type: "Function"
      }
    ];
    const contract = await tronWeb.contract(abi, methodConfig.tokenContract);
    const balance = BigInt((await contract.balanceOf(method.address).call()).toString());

    return {
      currentAtomic: balance.toString(),
      confirmedAtomic: balance.toString(),
      txHash: null
    };
  }

  async checkBitcoin(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readBitcoinBalances(method, methodConfig);
    const current = BigInt(snapshot.currentAtomic);
    const confirmed = BigInt(snapshot.confirmedAtomic);
    const currentDelta = current - baselineCurrent;
    const confirmedDelta = confirmed - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals),
        txHash: snapshot.txHash
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals),
        txHash: snapshot.txHash
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null,
      txHash: null
    };
  }

  async readBitcoinBalances(method, methodConfig) {
    const tipHeight = Number(await fetch(`${methodConfig.apiBaseUrl}/blocks/tip/height`).then((res) => res.text()));
    const utxos = await fetchJson(`${methodConfig.apiBaseUrl}/address/${method.address}/utxo`);

    let confirmed = 0n;
    let current = 0n;
    let txHash = null;

    for (const utxo of utxos) {
      const value = BigInt(utxo.value);
      current += value;
      txHash = txHash ?? utxo.txid;

      if (utxo.status?.confirmed) {
        const confirmations = tipHeight - Number(utxo.status.block_height) + 1;
        if (confirmations >= Number(methodConfig.confirmations)) {
          confirmed += value;
        }
      }
    }

    return {
      currentAtomic: current.toString(),
      confirmedAtomic: confirmed.toString(),
      txHash
    };
  }

  async checkSuiNative(method, methodConfig, expectedAtomic, minAtomic, baselineCurrent, baselineConfirmed) {
    const snapshot = await this.readSuiNativeBalances(method, methodConfig);
    const current = BigInt(snapshot.currentAtomic);
    const confirmed = BigInt(snapshot.confirmedAtomic);
    const currentDelta = current - baselineCurrent;
    const confirmedDelta = confirmed - baselineConfirmed;

    if (confirmedDelta >= minAtomic) {
      return {
        status: "paid",
        receivedAtomic: confirmedDelta.toString(),
        receivedDisplayAmount: formatUnits(confirmedDelta, methodConfig.decimals)
      };
    }

    if (currentDelta > 0n) {
      return {
        status: currentDelta >= minAtomic ? "detected" : "partial",
        receivedAtomic: currentDelta.toString(),
        receivedDisplayAmount: formatUnits(currentDelta, methodConfig.decimals)
      };
    }

    return {
      status: "pending",
      receivedAtomic: null,
      receivedDisplayAmount: null
    };
  }

  async readSuiNativeBalances(method, methodConfig) {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getBalance",
      params: [method.address]
    };

    const payload = await fetchJson(methodConfig.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const total = BigInt(payload?.result?.totalBalance ?? "0");
    return {
      currentAtomic: total.toString(),
      confirmedAtomic: total.toString(),
      txHash: null
    };
  }
}
