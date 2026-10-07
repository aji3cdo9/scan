import {
  NextRequest,
  NextResponse,
} from "next/server";

const BASE58 =
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const WSOL =
  "So11111111111111111111111111111111111111112";

const EXIT_SIZES = [
  100,
  500,
  1000,
  5000,
];

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
  chainId?: string;
  dexId?: string;

  baseToken?: {
    address?: string;
  };

  quoteToken?: {
    address?: string;
  };

  priceUsd?:
    | string
    | null;

  liquidity?: {
    usd?:
      | number
      | null;
  };
};

type JupiterQuote = {
  outAmount?: string;
  priceImpactPct?: string;

  routePlan?: unknown[];

  error?: string;
  errorCode?: string;
};

type ExitResult = {
  sizeUsd: number;

  tokensIn: number;

  solOut:
    | number
    | null;

  priceImpactPct:
    | number
    | null;

  routeAvailable: boolean;

  error:
    | string
    | null;
};

function sleep(
  ms: number
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
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

    if (!BASE58.test(mint)) {
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

    const heliusKey =
      process.env
        .HELIUS_API_KEY;

    const jupiterKey =
      process.env
        .JUPITER_API_KEY;

    if (!heliusKey) {
      return NextResponse.json(
        {
          error:
            "HELIUS_API_KEY missing.",
        },
        {
          status: 500,
        }
      );
    }

    if (!jupiterKey) {
      return NextResponse.json(
        {
          error:
            "JUPITER_API_KEY missing.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * --------------------------------
     * GET TOKEN DECIMALS
     * --------------------------------
     */

    const mintResponse =
      await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            jsonrpc: "2.0",

            id: "scan-exit",

            method:
              "getAccountInfo",

            params: [
              mint,

              {
                encoding:
                  "jsonParsed",

                commitment:
                  "confirmed",
              },
            ],
          }),

          cache: "no-store",
        }
      );

    if (!mintResponse.ok) {
      return NextResponse.json(
        {
          error:
            `Helius returned ${mintResponse.status}.`,
        },
        {
          status:
            mintResponse.status,
        }
      );
    }

    const mintData =
      (await mintResponse.json()) as
        MintAccountResponse;

    const decimals =
      mintData.result?.value
        ?.data?.parsed?.info
        ?.decimals;

    if (
      typeof decimals !==
      "number"
    ) {
      return NextResponse.json(
        {
          error:
            "Could not determine token decimals.",
        },
        {
          status: 422,
        }
      );
    }

    /*
     * --------------------------------
     * GET MARKET PRICE
     * --------------------------------
     *
     * DexScreener gives us a current
     * USD reference price so we can
     * calculate how many tokens roughly
     * represent $100 / $500 / etc.
     */

    const dexResponse =
      await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
        {
          cache: "no-store",

          headers: {
            Accept:
              "application/json",
          },
        }
      );

    if (!dexResponse.ok) {
      return NextResponse.json(
        {
          error:
            "Could not load market price.",
        },
        {
          status: 502,
        }
      );
    }

    const pairs =
      (await dexResponse.json()) as
        DexPair[];

    if (
      !Array.isArray(
        pairs
      )
    ) {
      return NextResponse.json(
        {
          error:
            "No market data found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * priceUsd describes the
     * base token, so only use pools
     * where our token is base.
     *
     * Prefer the deepest pool.
     */

    const usablePairs =
      pairs
        .filter(
          (pair) =>
            pair.baseToken
              ?.address ===
              mint &&
            pair.priceUsd &&
            Number(
              pair.priceUsd
            ) > 0
        )
        .sort(
          (a, b) =>
            (b.liquidity
              ?.usd ??
              0) -
            (a.liquidity
              ?.usd ??
              0)
        );

    const bestPair =
      usablePairs[0];

    if (!bestPair) {
      return NextResponse.json(
        {
          error:
            "No usable USD market price found for this token.",
        },
        {
          status: 404,
        }
      );
    }

    const tokenPriceUsd =
      Number(
        bestPair.priceUsd
      );

    if (
      !Number.isFinite(
        tokenPriceUsd
      ) ||
      tokenPriceUsd <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Token price is unavailable.",
        },
        {
          status: 422,
        }
      );
    }

    /*
     * --------------------------------
     * JUPITER EXIT QUOTES
     * --------------------------------
     */

    const results:
      ExitResult[] = [];

    for (
      let index = 0;
      index <
      EXIT_SIZES.length;
      index++
    ) {
      const sizeUsd =
        EXIT_SIZES[index];

      const tokensIn =
        sizeUsd /
        tokenPriceUsd;

      const rawAmount =
        Math.floor(
          tokensIn *
            Math.pow(
              10,
              decimals
            )
        );

      if (
        !Number.isFinite(
          rawAmount
        ) ||
        rawAmount <= 0
      ) {
        results.push({
          sizeUsd,

          tokensIn,

          solOut: null,

          priceImpactPct:
            null,

          routeAvailable:
            false,

          error:
            "Invalid quote amount.",
        });

        continue;
      }

      /*
       * Jupiter free tier:
       * keep the requests spaced out.
       */

      if (index > 0) {
        await sleep(
          1100
        );
      }

      const quoteUrl =
        new URL(
          "https://api.jup.ag/swap/v1/quote"
        );

      quoteUrl.searchParams.set(
        "inputMint",
        mint
      );

      quoteUrl.searchParams.set(
        "outputMint",
        WSOL
      );

      quoteUrl.searchParams.set(
        "amount",
        String(rawAmount)
      );

      quoteUrl.searchParams.set(
        "slippageBps",
        "100"
      );

      quoteUrl.searchParams.set(
        "instructionVersion",
        "V2"
      );

      try {
        const quoteResponse =
          await fetch(
            quoteUrl.toString(),
            {
              headers: {
                "x-api-key":
                  jupiterKey,
              },

              cache:
                "no-store",
            }
          );

        const rawQuote =
          await quoteResponse.text();

        if (
          !quoteResponse.ok
        ) {
          results.push({
            sizeUsd,

            tokensIn,

            solOut:
              null,

            priceImpactPct:
              null,

            routeAvailable:
              false,

            error:
              `Jupiter ${quoteResponse.status}`,
          });

          continue;
        }

        let quote:
          JupiterQuote;

        try {
          quote =
            JSON.parse(
              rawQuote
            );
        } catch {
          results.push({
            sizeUsd,

            tokensIn,

            solOut:
              null,

            priceImpactPct:
              null,

            routeAvailable:
              false,

            error:
              "Invalid Jupiter response.",
          });

          continue;
        }

        if (
          quote.error ||
          !quote.outAmount
        ) {
          results.push({
            sizeUsd,

            tokensIn,

            solOut:
              null,

            priceImpactPct:
              null,

            routeAvailable:
              false,

            error:
              quote.error ??
              "No route.",
          });

          continue;
        }

        const solOut =
          Number(
            quote.outAmount
          ) /
          1_000_000_000;

        /*
         * Jupiter documents
         * priceImpactPct as a decimal.
         *
         * 0.01 = 1%
         */

        const rawImpact =
          Number(
            quote.priceImpactPct ??
              0
          );

        const impactPct =
          Number.isFinite(
            rawImpact
          )
            ? rawImpact *
              100
            : null;

        results.push({
          sizeUsd,

          tokensIn,

          solOut,

          priceImpactPct:
            impactPct,

          routeAvailable:
            true,

          error: null,
        });
      } catch (
        quoteError
      ) {
        results.push({
          sizeUsd,

          tokensIn,

          solOut: null,

          priceImpactPct:
            null,

          routeAvailable:
            false,

          error:
            quoteError instanceof
            Error
              ? quoteError.message
              : "Quote failed.",
        });
      }
    }

    /*
     * --------------------------------
     * SIMPLE ROUTE VERDICT
     * --------------------------------
     */

    const available =
      results.filter(
        (result) =>
          result.routeAvailable
      );

    const impacts =
      available
        .map(
          (result) =>
            result.priceImpactPct
        )
        .filter(
          (
            impact
          ): impact is number =>
            impact !== null
        );

    const worstImpact =
      impacts.length
        ? Math.max(
            ...impacts
          )
        : null;

    let verdict =
      "NO ROUTE";

    if (
      available.length ===
      results.length
    ) {
      if (
        worstImpact ===
        null
      ) {
        verdict =
          "ROUTABLE";
      } else if (
        worstImpact < 1
      ) {
        verdict =
          "DEEP";
      } else if (
        worstImpact < 3
      ) {
        verdict =
          "GOOD";
      } else if (
        worstImpact < 8
      ) {
        verdict =
          "THIN";
      } else {
        verdict =
          "SEVERE IMPACT";
      }
    } else if (
      available.length > 0
    ) {
      verdict =
        "LIMITED";
    }

    return NextResponse.json({
      mint,

      tokenPriceUsd,

      decimals,

      market: {
        dex:
          bestPair.dexId ??
          "UNKNOWN",

        liquidityUsd:
          bestPair
            .liquidity
            ?.usd ??
          null,
      },

      quotes:
        results,

      verdict,

      note:
        "Quotes are live routing snapshots, not guaranteed execution prices.",
    });
  } catch (error) {
    console.error(
      "EXIT API ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Exit analysis failed.",
      },
      {
        status: 500,
      }
    );
  }
}