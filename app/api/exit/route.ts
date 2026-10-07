import { NextRequest, NextResponse } from "next/server";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const USDC =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const USDC_DECIMALS = 6;

type MintAccountResponse = {
  result?: {
    value?: {
      data?: {
        parsed?: {
          info?: {
            decimals?: number;
          };
        };
      };
    } | null;
  };
};

type DexPair = {
  dexId?: string;

  baseToken?: {
    address?: string;
  };

  priceUsd?: string | null;

  liquidity?: {
    usd?: number | null;
  } | null;
};

type JupiterQuote = {
  outAmount?: string;
  priceImpactPct?: string;
  error?: string;
};

function getRating(
  impact: number | null,
  routeAvailable: boolean
) {
  if (!routeAvailable) return "NO ROUTE";
  if (impact === null) return "UNKNOWN";

  if (impact < 1) return "EXCELLENT";
  if (impact < 3) return "GOOD";
  if (impact < 5) return "OK";
  if (impact < 10) return "THIN";
  if (impact < 20) return "HIGH RISK";

  return "SEVERE";
}

export async function GET(request: NextRequest) {
  try {
    const mint =
      request.nextUrl.searchParams.get("mint")?.trim() ?? "";

    const amountParam =
      request.nextUrl.searchParams.get("amount")?.trim() ?? "";

    const positionUsd = Number(amountParam);

    if (!mint) {
      return NextResponse.json(
        { error: "Missing mint." },
        { status: 400 }
      );
    }

    if (!BASE58.test(mint)) {
      return NextResponse.json(
        { error: "Invalid Solana mint." },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(positionUsd) ||
      positionUsd <= 0
    ) {
      return NextResponse.json(
        {
          error: "Enter a valid position size.",
        },
        {
          status: 400,
        }
      );
    }

    if (positionUsd > 1_000_000) {
      return NextResponse.json(
        {
          error: "Position size is too large.",
        },
        {
          status: 400,
        }
      );
    }

    const heliusKey = process.env.HELIUS_API_KEY;
    const jupiterKey = process.env.JUPITER_API_KEY;

    if (!heliusKey) {
      return NextResponse.json(
        { error: "HELIUS_API_KEY missing." },
        { status: 500 }
      );
    }

    if (!jupiterKey) {
      return NextResponse.json(
        { error: "JUPITER_API_KEY missing." },
        { status: 500 }
      );
    }

    // TOKEN DECIMALS

    const mintResponse = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "scan-exit",
          method: "getAccountInfo",

          params: [
            mint,
            {
              encoding: "jsonParsed",
              commitment: "confirmed",
            },
          ],
        }),

        cache: "no-store",
      }
    );

    if (!mintResponse.ok) {
      return NextResponse.json(
        {
          error: `Helius returned ${mintResponse.status}.`,
        },
        {
          status: mintResponse.status,
        }
      );
    }

    const mintData =
      (await mintResponse.json()) as MintAccountResponse;

    const decimals =
      mintData.result?.value?.data?.parsed?.info?.decimals;

    if (typeof decimals !== "number") {
      return NextResponse.json(
        {
          error: "Could not determine token decimals.",
        },
        {
          status: 422,
        }
      );
    }

    // USD REFERENCE PRICE

    const dexResponse = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
      {
        cache: "no-store",

        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!dexResponse.ok) {
      return NextResponse.json(
        {
          error: "Could not load token market data.",
        },
        {
          status: 502,
        }
      );
    }

    const pairs = (await dexResponse.json()) as DexPair[];

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return NextResponse.json(
        {
          error: "No market data found.",
        },
        {
          status: 404,
        }
      );
    }

    const usablePairs = pairs
      .filter(
        (pair) =>
          pair.baseToken?.address === mint &&
          pair.priceUsd &&
          Number(pair.priceUsd) > 0
      )
      .sort(
        (a, b) =>
          (b.liquidity?.usd ?? 0) -
          (a.liquidity?.usd ?? 0)
      );

    const bestPair = usablePairs[0];

    if (!bestPair) {
      return NextResponse.json(
        {
          error: "No usable USD market price found.",
        },
        {
          status: 404,
        }
      );
    }

    const tokenPriceUsd = Number(bestPair.priceUsd);

    if (
      !Number.isFinite(tokenPriceUsd) ||
      tokenPriceUsd <= 0
    ) {
      return NextResponse.json(
        {
          error: "Token price unavailable.",
        },
        {
          status: 422,
        }
      );
    }

    // CONVERT USER POSITION INTO APPROX TOKEN AMOUNT

    const tokensIn =
      positionUsd / tokenPriceUsd;

    const rawAmount = Math.floor(
      tokensIn * Math.pow(10, decimals)
    );

    if (
      !Number.isFinite(rawAmount) ||
      rawAmount <= 0
    ) {
      return NextResponse.json(
        {
          error: "Could not calculate token amount.",
        },
        {
          status: 422,
        }
      );
    }

    // LIVE TOKEN -> USDC QUOTE

    const quoteUrl = new URL(
      "https://api.jup.ag/swap/v1/quote"
    );

    quoteUrl.searchParams.set("inputMint", mint);
    quoteUrl.searchParams.set("outputMint", USDC);
    quoteUrl.searchParams.set("amount", String(rawAmount));
    quoteUrl.searchParams.set("slippageBps", "100");
    quoteUrl.searchParams.set(
      "instructionVersion",
      "V2"
    );

    const quoteResponse = await fetch(
      quoteUrl.toString(),
      {
        headers: {
          "x-api-key": jupiterKey,
        },

        cache: "no-store",
      }
    );

    const rawQuote = await quoteResponse.text();

    if (!quoteResponse.ok) {
      console.error("Jupiter error:", rawQuote);

      return NextResponse.json(
        {
          error: `Jupiter returned ${quoteResponse.status}.`,
        },
        {
          status: quoteResponse.status,
        }
      );
    }

    let quote: JupiterQuote;

    try {
      quote = JSON.parse(rawQuote);
    } catch {
      return NextResponse.json(
        {
          error: "Jupiter returned an invalid response.",
        },
        {
          status: 502,
        }
      );
    }

    if (quote.error || !quote.outAmount) {
      return NextResponse.json(
        {
          mint,
          positionUsd,
          tokenPriceUsd,

          market: {
            dex: bestPair.dexId ?? "UNKNOWN",
          },

          routeAvailable: false,

          estimatedReceiveUsd: null,
          priceImpactPct: null,
          rating: "NO ROUTE",

          error:
            quote.error ??
            "No sell route available.",
        },
        {
          status: 200,
        }
      );
    }

    const estimatedReceiveUsd =
      Number(quote.outAmount) /
      Math.pow(10, USDC_DECIMALS);

    const rawImpact =
      Number(quote.priceImpactPct ?? 0);

    const priceImpactPct =
      Number.isFinite(rawImpact)
        ? rawImpact * 100
        : null;

    const differenceUsd =
      estimatedReceiveUsd - positionUsd;

    const differencePct =
      positionUsd > 0
        ? (differenceUsd / positionUsd) * 100
        : 0;

    const rating =
      getRating(
        priceImpactPct,
        true
      );

    return NextResponse.json({
      mint,

      positionUsd,

      tokenPriceUsd,

      tokensIn,

      market: {
        dex:
          bestPair.dexId ??
          "UNKNOWN",
      },

      routeAvailable: true,

      estimatedReceiveUsd,

      priceImpactPct,

      differenceUsd,

      differencePct,

      rating,

      output: "USDC",

      note:
        "Position size is approximate based on the current reference USD price. Jupiter output is a live routing estimate and not a guaranteed fill.",
    });
  } catch (error) {
    console.error(
      "EXIT API ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Exit analysis failed.",
      },
      {
        status: 500,
      }
    );
  }
}