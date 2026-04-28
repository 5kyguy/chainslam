export const KNOWN_TOKENS: Record<string, string> = {
  ETH: "0x0000000000000000000000000000000000000000",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
};

const KNOWN_TOKENS_BY_CHAIN: Record<number, Record<string, string>> = {
  1: KNOWN_TOKENS,
  11155111: {
    ETH: "0x0000000000000000000000000000000000000000",
    WETH: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    USDC: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  },
};

export const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WBTC: 8,
  UNI: 18,
};

export function resolveToken(symbolOrAddress: string, chainId = 1): string {
  if (symbolOrAddress.startsWith("0x")) return symbolOrAddress;
  const tokens = KNOWN_TOKENS_BY_CHAIN[chainId] ?? KNOWN_TOKENS;
  return tokens[symbolOrAddress.toUpperCase()] ?? KNOWN_TOKENS[symbolOrAddress.toUpperCase()] ?? symbolOrAddress;
}

export function tokenDecimals(symbolOrAddress: string, chainId = 1): number {
  if (symbolOrAddress.startsWith("0x")) {
    const tokens = KNOWN_TOKENS_BY_CHAIN[chainId] ?? KNOWN_TOKENS;
    for (const [symbol, addr] of Object.entries(tokens)) {
      if (addr.toLowerCase() === symbolOrAddress.toLowerCase()) {
        return TOKEN_DECIMALS[symbol] ?? 18;
      }
    }
    return 18;
  }
  return TOKEN_DECIMALS[symbolOrAddress.toUpperCase()] ?? 18;
}

export function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Amount must be a non-negative finite number.");
  }

  const [whole, fraction = ""] = amount.toString().split(".");
  if (decimals === 0) {
    return BigInt(whole).toString();
  }
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${whole}${paddedFraction}`).toString();
}

export function fromBaseUnits(amount: string, decimals: number): number {
  const intPart = amount.slice(0, -decimals) || "0";
  const fracPart = amount.slice(-decimals).padStart(decimals, "0");
  return Number(`${intPart}.${fracPart}`);
}
