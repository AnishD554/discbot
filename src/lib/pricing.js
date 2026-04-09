export async function fetchUsdQuotes(config) {
  const ids = [...new Set(config.paymentMethods.map((method) => method.coingeckoId))];
  const url = new URL(config.coingeckoApiUrl);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CoinGecko quote request failed with ${response.status}`);
  }

  const payload = await response.json();
  const missingIds = ids.filter((id) => !payload[id]?.usd);
  if (missingIds.length > 0) {
    throw new Error(`Missing USD prices for: ${missingIds.join(", ")}`);
  }

  return payload;
}

export function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatCryptoAmount(amount, decimals = 8) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
    useGrouping: false
  }).format(amount);
}
