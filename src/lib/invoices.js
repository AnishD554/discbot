import { parseUnits } from "ethers";
import { resolveInvoiceTarget } from "./addresses.js";
import { formatCryptoAmount } from "./pricing.js";

function invoiceIdFromSequence(sequence) {
  return `INV-${String(sequence).padStart(6, "0")}`;
}

function resolvePaymentAddress(mnemonic, method, derivationIndex) {
  return resolveInvoiceTarget(mnemonic, method, derivationIndex);
}

function amountToAtomic(amountString, decimals) {
  return parseUnits(amountString, decimals).toString();
}

function minAtomicAmount(expectedAtomic, percentFloor = 99n) {
  return ((BigInt(expectedAtomic) * percentFloor) / 100n).toString();
}

export function buildInvoice({ config, store, user, guildId, usdAmount, exam, brand, note, quotes }) {
  const sequence = store.nextInvoiceSequence();
  const invoiceId = invoiceIdFromSequence(sequence);
  const createdAt = new Date().toISOString();

  const resolvedBrand = brand ?? "YSL";
  const methods = config.paymentMethods
    .filter((method) => (method.brand ?? "YSL") === resolvedBrand)
    .map((method) => {
    const derivationIndex = store.nextDerivationIndex();
    const target = resolvePaymentAddress(config.paymentMnemonic, method, derivationIndex);
    const usdPerCoin = Number(quotes[method.coingeckoId].usd);
    const exactAmount = usdAmount / usdPerCoin;
    const displayAmount = formatCryptoAmount(exactAmount, method.quoteDecimals ?? 8);
    const expectedAtomic = amountToAtomic(displayAmount, method.decimals);

    return {
      id: `${invoiceId}:${method.id}`,
      methodId: method.id,
      buttonLabel: method.buttonLabel ?? method.symbol,
      paymentTitle: method.paymentTitle ?? `${method.symbol} Payment`,
      network: method.network,
      symbol: method.symbol,
      address: target.address,
      ownerAddress: target.ownerAddress ?? null,
      derivationIndex,
      usdPerCoin,
      displayAmount,
      expectedAtomic,
      minAtomic: minAtomicAmount(expectedAtomic),
      watcherType: method.watcherType ?? "manual",
      quoteDecimals: method.quoteDecimals ?? 8,
      baselineCurrentAtomic: null,
      baselineConfirmedAtomic: null,
      status: "pending",
      detectedTxHash: null,
      detectedBlockNumber: null,
      receivedAtomic: null,
      receivedDisplayAmount: null,
      createdBlockNumber: null,
      paidAt: null,
      explorerTxBaseUrl: method.explorerTxBaseUrl ?? ""
    };
  });

  return {
    id: invoiceId,
    userId: user.id,
    username: user.tag ?? user.username,
    guildId,
    channelId: null,
    messageId: null,
    usdAmount,
    exam: exam ?? "",
    note: note ?? "",
    createdAt,
    updatedAt: createdAt,
    paidAnnouncementSentAt: null,
    status: "pending",
    selectedMethodId: null,
    methods
  };
}
