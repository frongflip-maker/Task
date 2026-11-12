const MAX_MARKET_SYMBOLS = 7;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.end(JSON.stringify(payload));
}

function appSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function providerSymbol(symbol) {
  if (["BTC", "XBT", "BTC/THB"].includes(symbol)) return "BTC/USD";
  if (symbol === "XAU") return "XAU/USD";
  return symbol;
}

function quoteMeta(symbol) {
  return {
    currency: "USD",
    unit: symbol === "XAU" ? "oz" : "unit",
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function responseFor(payload, provider, providerCount) {
  if (providerCount === 1 && payload && Object.prototype.hasOwnProperty.call(payload, "price")) return payload;
  return payload?.[provider] || payload?.[provider.replace("/", "")] || null;
}

module.exports = async function marketPrices(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return send(res, 503, { error: "TWELVE_DATA_API_KEY is not configured" });

  const body = parseBody(req);
  const requested = [...new Set((Array.isArray(body.symbols) ? body.symbols : [])
    .map(appSymbol)
    .filter(symbol => /^[A-Z0-9][A-Z0-9._:/ -]{0,23}$/.test(symbol) && symbol !== "CASH"))]
    .slice(0, MAX_MARKET_SYMBOLS);
  const includeFx = body.includeFx !== false;
  const providers = new Map();
  for (const symbol of requested) {
    const provider = providerSymbol(symbol);
    if (!providers.has(provider)) providers.set(provider, []);
    providers.get(provider).push(symbol);
  }
  if (includeFx && !providers.has("USD/THB")) providers.set("USD/THB", []);
  if (!providers.size) return send(res, 400, { error: "No valid symbols supplied" });

  const providerList = [...providers.keys()];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let payload;
  try {
    const url = new URL("https://api.twelvedata.com/price");
    url.searchParams.set("symbol", providerList.join(","));
    url.searchParams.set("dp", "8");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error("Market data provider did not return a valid response");
  } catch (error) {
    clearTimeout(timer);
    return send(res, 502, { error: error?.name === "AbortError" ? "Market data request timed out" : (error?.message || "Market data request failed") });
  }
  clearTimeout(timer);

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const updatedAt = now.toISOString();
  const quotes = {};
  const errors = [];
  let fx = null;

  for (const provider of providerList) {
    const row = responseFor(payload, provider, providerList.length);
    const price = Number(row?.price);
    if (!(price > 0 && Number.isFinite(price))) {
      const originals = providers.get(provider);
      errors.push({ symbol: originals.length ? originals.join(", ") : provider, message: String(row?.message || payload?.message || "Price unavailable").slice(0, 160) });
      continue;
    }
    if (provider === "USD/THB") {
      fx = { value: price, date, updatedAt, source: "api" };
      continue;
    }
    for (const symbol of providers.get(provider)) {
      quotes[symbol] = { value: price, date, updatedAt, source: "api", ...quoteMeta(symbol) };
    }
  }

  return send(res, 200, { quotes, fx, errors, updatedAt, provider: "Twelve Data" });
};
