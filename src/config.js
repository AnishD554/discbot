import "dotenv/config";
import path from "node:path";

const DEFAULT_METHODS = [
  {
    id: "btc",
    buttonLabel: "₿ BTC",
    paymentTitle: "₿ Bitcoin Payment",
    network: "Bitcoin",
    symbol: "BTC",
    coingeckoId: "bitcoin",
    quoteDecimals: 8,
    decimals: 8,
    watcherType: "bitcoin_api",
    addressSource: "fixed",
    address: "bc1p2709s2xhuvt337j9yf0ds7t664tsgtp94wwam4nx4n05ld98sljqem8v7r",
    bitcoinNetwork: "mainnet",
    apiBaseUrl: "https://blockstream.info/api",
    confirmations: 1
  },
  {
    id: "eth",
    buttonLabel: "Ξ ETH",
    paymentTitle: "Ξ Ethereum Payment",
    network: "Ethereum",
    symbol: "ETH",
    coingeckoId: "ethereum",
    quoteDecimals: 8,
    decimals: 18,
    watcherType: "evm_native",
    addressSource: "fixed",
    address: "0x443056E002c9Af0e1DF99A5d60e9D0633E19B70C",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    confirmations: 2
  },
  {
    id: "base",
    buttonLabel: "Base ETH",
    paymentTitle: "Base Payment",
    network: "Base",
    symbol: "ETH",
    coingeckoId: "ethereum",
    quoteDecimals: 8,
    decimals: 18,
    watcherType: "evm_native",
    addressSource: "fixed",
    address: "0x443056E002c9Af0e1DF99A5d60e9D0633E19B70C",
    rpcUrl: "https://mainnet.base.org",
    confirmations: 2
  },
  {
    id: "polygon",
    buttonLabel: "POL",
    paymentTitle: "Polygon Payment",
    network: "Polygon",
    symbol: "POL",
    coingeckoId: "polygon-ecosystem-token",
    quoteDecimals: 8,
    decimals: 18,
    watcherType: "evm_native",
    addressSource: "fixed",
    address: "0x443056E002c9Af0e1DF99A5d60e9D0633E19B70C",
    rpcUrl: "https://polygon.drpc.org",
    confirmations: 8
  },
  {
    id: "monad",
    buttonLabel: "MONAD",
    paymentTitle: "Monad Payment",
    network: "Monad",
    symbol: "MON",
    coingeckoId: "ethereum",
    quoteDecimals: 8,
    decimals: 18,
    watcherType: "manual",
    addressSource: "fixed",
    address: "0x443056E002c9Af0e1DF99A5d60e9D0633E19B70C"
  },
  {
    id: "sol",
    buttonLabel: "◎ SOL",
    paymentTitle: "◎ Solana Payment",
    network: "Solana",
    symbol: "SOL",
    coingeckoId: "solana",
    quoteDecimals: 6,
    decimals: 9,
    watcherType: "solana_native",
    addressSource: "fixed",
    address: "28ek6Za1q3NCvuSzCD74iDcPbNUTZAcrKtvzYYwdKPUW",
    rpcUrl: "https://api.mainnet-beta.solana.com"
  },
  {
    id: "usdt-erc20",
    buttonLabel: "₮ USDT (ERC-20)",
    paymentTitle: "₮ USDT Payment",
    network: "Ethereum ERC-20",
    symbol: "USDT",
    coingeckoId: "tether",
    quoteDecimals: 2,
    decimals: 6,
    watcherType: "evm_erc20",
    addressSource: "fixed",
    address: "0x443056E002c9Af0e1DF99A5d60e9D0633E19B70C",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    confirmations: 2,
    tokenContract: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
  },
  {
    id: "usdc-sol",
    buttonLabel: "$ USDC (SOL)",
    paymentTitle: "$ USDC Payment",
    network: "Solana SPL",
    symbol: "USDC",
    coingeckoId: "usd-coin",
    quoteDecimals: 2,
    decimals: 6,
    watcherType: "solana_spl",
    addressSource: "fixed",
    address: "28ek6Za1q3NCvuSzCD74iDcPbNUTZAcrKtvzYYwdKPUW",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  },
  {
    id: "sui",
    buttonLabel: "SUI",
    paymentTitle: "Sui Payment",
    network: "Sui",
    symbol: "SUI",
    coingeckoId: "sui",
    quoteDecimals: 6,
    decimals: 9,
    watcherType: "sui_native",
    addressSource: "fixed",
    address: "0xe6e695836611dba60da1a62bb31560c8f293fddcc56dfc4a24d6cb5cd59e959b",
    rpcUrl: "https://fullnode.mainnet.sui.io:443"
  }
];

const watcherRequirements = {
  manual: [],
  evm_native: ["rpcUrl", "confirmations"],
  evm_erc20: ["rpcUrl", "confirmations", "tokenContract"],
  solana_native: ["rpcUrl"],
  solana_spl: ["rpcUrl", "tokenMint"],
  tron_native: ["fullHost"],
  tron_trc20: ["fullHost", "tokenContract"],
  bitcoin_api: ["apiBaseUrl", "confirmations"],
  sui_native: ["rpcUrl"]
};

function parsePaymentMethods() {
  if (!process.env.PAYMENT_METHODS_JSON) {
    return DEFAULT_METHODS;
  }

  let parsed;
  try {
    parsed = JSON.parse(process.env.PAYMENT_METHODS_JSON);
  } catch (error) {
    throw new Error(`PAYMENT_METHODS_JSON is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("PAYMENT_METHODS_JSON must be a non-empty JSON array.");
  }

  for (const method of parsed) {
    const requiredKeys = [
      "id",
      "network",
      "symbol",
      "coingeckoId",
      "decimals",
      "watcherType"
    ];

    for (const key of requiredKeys) {
      if (method[key] === undefined || method[key] === null || method[key] === "") {
        throw new Error(`Payment method "${method.id ?? "unknown"}" is missing "${key}".`);
      }
    }

    const watcherKeys = watcherRequirements[method.watcherType] ?? [];
    for (const key of watcherKeys) {
      if (method[key] === undefined || method[key] === null || method[key] === "") {
        throw new Error(`Payment method "${method.id}" is missing "${key}".`);
      }
    }

    if ((method.addressSource ?? "fixed") === "derived") {
      if (!method.keyScheme || !method.derivationPath) {
        throw new Error(`Payment method "${method.id}" needs keyScheme and derivationPath.`);
      }
    }

    if ((method.addressSource ?? "fixed") === "fixed" && !method.address) {
      throw new Error(`Payment method "${method.id}" needs an address.`);
    }
  }

  return parsed;
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  allowedUserIds: (process.env.ALLOWED_USER_IDS ??
    "1430336862999805998,713152544209240194,1457150473281732799")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  paidRoleId: process.env.PAID_ROLE_ID ?? "",
  paidMentionId: process.env.PAID_MENTION_ID ?? "1430336862999805998",
  ticketCategoryId: process.env.TICKET_CATEGORY_ID ?? "",
  ticketArchiveCategoryId: process.env.TICKET_ARCHIVE_CATEGORY_ID ?? "",
  ticketSupportRoleIds: (process.env.TICKET_SUPPORT_ROLE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  paymentMnemonic: process.env.PAYMENT_MNEMONIC ?? "",
  defaultWatermarkOverlayOnePath:
    process.env.DEFAULT_WATERMARK_OVERLAY_ONE_PATH ??
    path.resolve("assets", "watermark-overlay-1.png"),
  defaultWatermarkOverlayTwoPath:
    process.env.DEFAULT_WATERMARK_OVERLAY_TWO_PATH ??
    path.resolve("assets", "watermark-overlay-2.png"),
  coingeckoApiUrl:
    process.env.COINGECKO_API_URL ?? "https://api.coingecko.com/api/v3/simple/price",
  watchIntervalMs: Number.parseInt(process.env.WATCH_INTERVAL_MS ?? "15000", 10),
  paymentMethods: parsePaymentMethods()
};

export function validateConfig() {
  const missing = [];

  if (!config.discordToken) missing.push("DISCORD_TOKEN");
  if (!config.discordClientId) missing.push("DISCORD_CLIENT_ID");
  const needsMnemonic = config.paymentMethods.some(
    (method) => (method.addressSource ?? "fixed") === "derived"
  );
  if (needsMnemonic && !config.paymentMnemonic) missing.push("PAYMENT_MNEMONIC");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
