import {
  NextRequest,
  NextResponse,
} from "next/server";

const BASE58 =
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type TxWindow = {
  buys?: number;
  sells?: number;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;

  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };

  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };

  priceUsd?: string | null;

  txns?: {
    m5?: TxWindow;
    h1?: TxWindow;
    h6?: TxWindow;
    h24?: TxWindow;
  };

  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };

  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  } | null;

  liquidity?: {
    usd?: number | null;
    base?: number;
    quote?: number;
  } | null;

  fdv?: number | null;
  marketCap?: number | null;

  pairCreatedAt?:
    | number
    | null;
};

type FlowWindow = {
  buys: number;
  sells: number;
  total: number;
  buySharePct:
    | number
    | null;
};

function makeWindow(
  value?: TxWindow
): FlowWindow {
  const buys =
    Number(
      value?.buys ?? 0
    );

  const sells =
    Number(
      value?.sells ?? 0
    );

  const total =
    buys + sells;

  return {
    buys,
    sells,
    total,

    buySharePct:
      total > 0
        ? (buys / total) *
          100
        : null,
  };
}

function getFlowVerdict(
  window: FlowWindow
) {
  if (
    window.total === 0 ||
    window.buySharePct ===
      null
  ) {
    return "NO ACTIVITY";
  }

  if (
    window.total < 5
  ) {
    return "LOW ACTIVITY";
  }

  if (
    window.buySharePct >=
    62
  ) {
    return "BUY HEAVY";
  }

  if (
    window.buySharePct >=
    54
  ) {
    return "BUY LEANING";
  }

  if (
    window.buySharePct >=
    46
  ) {
    return "BALANCED";
  }

  if (
    window.buySharePct >=
    38
  ) {
    return "SELL LEANING";
  }

  return "SELL HEAVY";
}

export async function GET(
  request: NextRequest
) {
  try {
    const mint =
      request.nextUrl
        .searchParams
        .get("mint")
        ?.trim() ?? "";

    if (!mint) {
      return NextResponse.json(
        {
          error:
            "Missing mint.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !BASE58.test(mint)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid Solana mint.",
        },
        {
          status: 400,
        }
      );
    }

    const response =
      await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
        {
          cache:
            "no-store",

          headers: {
            Accept:
              "application/json",
          },
        }
      );

    const raw =
      await response.text();

    if (!response.ok) {
      console.error(
        "DEX Screener error:",
        raw.slice(
          0,
          500
        )
      );

      return NextResponse.json(
        {
          error:
            `DEX Screener returned ${response.status}.`,
        },
        {
          status:
            response.status,
        }
      );
    }

    let pairs:
      DexPair[];

    try {
      pairs =
        JSON.parse(raw);
    } catch {
      console.error(
        "DEX Screener returned non-JSON:",
        raw.slice(
          0,
          500
        )
      );

      return NextResponse.json(
        {
          error:
            "DEX Screener returned an unexpected response.",
        },
        {
          status: 502,
        }
      );
    }

    if (
      !Array.isArray(
        pairs
      ) ||
      pairs.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No trading pairs found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Prefer pools where the
     * scanned token is the base
     * token.
     */
    const basePairs =
      pairs.filter(
        (pair) =>
          pair.baseToken
            ?.address ===
          mint
      );

    const candidates =
      basePairs.length > 0
        ? basePairs
        : pairs;

    /*
     * Use the deepest pool as
     * the reference market.
     */
    const sorted =
      [...candidates].sort(
        (a, b) => {
          const liquidityA =
            a.liquidity
              ?.usd ?? 0;

          const liquidityB =
            b.liquidity
              ?.usd ?? 0;

          if (
            liquidityB !==
            liquidityA
          ) {
            return (
              liquidityB -
              liquidityA
            );
          }

          return (
            (b.volume?.h24 ??
              0) -
            (a.volume?.h24 ??
              0)
          );
        }
      );

    const pair =
      sorted[0];

    if (!pair) {
      return NextResponse.json(
        {
          error:
            "No usable trading pair found.",
        },
        {
          status: 404,
        }
      );
    }

    const m5 =
      makeWindow(
        pair.txns?.m5
      );

    const h1 =
      makeWindow(
        pair.txns?.h1
      );

    const h6 =
      makeWindow(
        pair.txns?.h6
      );

    const h24 =
      makeWindow(
        pair.txns?.h24
      );

    /*
     * Prefer the 1H window
     * for the verdict.
     *
     * If it's too quiet, fall
     * back to 24H.
     */
    const verdictWindow =
      h1.total >= 5
        ? h1
        : h24;

    return NextResponse.json({
      mint,

      referencePair: {
        dex:
          pair.dexId ??
          "UNKNOWN",

        pairAddress:
          pair.pairAddress ??
          null,

        baseSymbol:
          pair.baseToken
            ?.symbol ??
          null,

        quoteSymbol:
          pair.quoteToken
            ?.symbol ??
          null,

        priceUsd:
          pair.priceUsd
            ? Number(
                pair.priceUsd
              )
            : null,

        liquidityUsd:
          pair.liquidity
            ?.usd ??
          null,

        marketCap:
          pair.marketCap ??
          null,

        fdv:
          pair.fdv ??
          null,

        pairCreatedAt:
          pair.pairCreatedAt ??
          null,
      },

      flow: {
        m5,
        h1,
        h6,
        h24,
      },

      volume: {
        m5:
          pair.volume?.m5 ??
          0,

        h1:
          pair.volume?.h1 ??
          0,

        h6:
          pair.volume?.h6 ??
          0,

        h24:
          pair.volume?.h24 ??
          0,
      },

      priceChange: {
        m5:
          pair.priceChange
            ?.m5 ??
          null,

        h1:
          pair.priceChange
            ?.h1 ??
          null,

        h6:
          pair.priceChange
            ?.h6 ??
          null,

        h24:
          pair.priceChange
            ?.h24 ??
          null,
      },

      verdict:
        getFlowVerdict(
          verdictWindow
        ),

      pairCount:
        pairs.length,

      note:
        "Transaction counts and market data describe the selected reference trading pair. These are not unique buyer-wallet counts.",
    });
  } catch (error) {
    console.error(
      "BUY FLOW API ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Buy flow scan failed.",
      },
      {
        status: 500,
      }
    );
  }
}