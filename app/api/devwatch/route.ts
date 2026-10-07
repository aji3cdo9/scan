import {
  NextRequest,
  NextResponse,
} from "next/server";

const BASE58 =
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type RpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

type AssetResult = {
  id?: string;

  interface?: string;

  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
  };

  token_info?: {
    decimals?: number;
    supply?: number | string;

    price_info?: {
      price_per_token?: number;
    };
  };

  authorities?: Array<{
    address?: string;
    scopes?: string[];
  }>;
};

type MintAccountResult = {
  value?: {
    data?: {
      parsed?: {
        info?: {
          decimals?: number;
          supply?: string;

          mintAuthority?:
            | string
            | null;

          freezeAuthority?:
            | string
            | null;
        };
      };
    };
  } | null;
};

type SignatureInfo = {
  signature: string;
  blockTime: number | null;
  err: unknown;
};

type ParsedAccountKey =
  | string
  | {
      pubkey: string;
      signer?: boolean;
      writable?: boolean;
    };

type ParsedTransaction = {
  blockTime?: number | null;

  transaction?: {
    message?: {
      accountKeys?: ParsedAccountKey[];
    };
  };
};

type BalanceResult = {
  value?: number;
};

type TokenAccountsResult = {
  value?: Array<{
    account?: {
      data?: {
        parsed?: {
          info?: {
            tokenAmount?: {
              uiAmount?: number | null;
              uiAmountString?: string;
            };
          };
        };
      };
    };
  }>;
};

type EnhancedTransaction = {
  signature?: string;
  type?: string;
  description?: string;
  timestamp?: number;
  fee?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

async function heliusRpc<T>(
  method: string,
  params: unknown
): Promise<T> {
  const apiKey =
    process.env.HELIUS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "HELIUS_API_KEY is missing from .env.local"
    );
  }

  const response = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "scan",
        method,
        params,
      }),

      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `Helius RPC returned ${response.status}`
    );
  }

  const data =
    (await response.json()) as RpcResponse<T>;

  if (data.error) {
    throw new Error(
      data.error.message ??
        "Helius RPC request failed."
    );
  }

  return data.result as T;
}

function accountKeyToString(
  key: ParsedAccountKey | undefined
) {
  if (!key) {
    return null;
  }

  if (typeof key === "string") {
    return key;
  }

  return key.pubkey ?? null;
}

function findProbableSigner(
  transaction:
    | ParsedTransaction
    | null
) {
  const keys =
    transaction?.transaction?.message
      ?.accountKeys ?? [];

  const explicitSigner =
    keys.find(
      (key) =>
        typeof key !== "string" &&
        key.signer === true
    );

  if (explicitSigner) {
    return accountKeyToString(
      explicitSigner
    );
  }

  return accountKeyToString(
    keys[0]
  );
}

function tokenAccountBalance(
  result: TokenAccountsResult
) {
  return (
    result.value?.reduce(
      (total, item) => {
        const amount =
          item.account?.data?.parsed
            ?.info?.tokenAmount;

        if (!amount) {
          return total;
        }

        const value =
          amount.uiAmount ??
          Number(
            amount.uiAmountString ??
              0
          );

        return (
          total +
          (Number.isFinite(value)
            ? value
            : 0)
        );
      },
      0
    ) ?? 0
  );
}

async function getRecentActivity(
  wallet: string
) {
  const apiKey =
    process.env.HELIUS_API_KEY;

  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&limit=5`,
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return [];
    }

    const transactions =
      (await response.json()) as EnhancedTransaction[];

    if (!Array.isArray(transactions)) {
      return [];
    }

    return transactions.map(
      (transaction) => ({
        signature:
          transaction.signature ??
          null,

        type:
          transaction.type ??
          "UNKNOWN",

        description:
          transaction.description ??
          "",

        timestamp:
          transaction.timestamp ??
          null,

        fee:
          transaction.fee ?? null,
      })
    );
  } catch {
    return [];
  }
}

export async function GET(
  request: NextRequest
) {
  try {
    const mint =
      request.nextUrl.searchParams
        .get("mint")
        ?.trim() ?? "";

    if (!mint) {
      return NextResponse.json(
        {
          error:
            "Missing token mint address.",
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
            "That does not look like a valid Solana mint address.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * First batch:
     * token metadata + parsed mint account
     */
    const [
      asset,
      mintAccount,
    ] = await Promise.all([
      heliusRpc<AssetResult>(
        "getAsset",
        {
          id: mint,

          displayOptions: {
            showFungible: true,
          },
        }
      ),

      heliusRpc<MintAccountResult>(
        "getAccountInfo",
        [
          mint,
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
          },
        ]
      ),
    ]);

    const mintInfo =
      mintAccount.value?.data
        ?.parsed?.info;

    if (!asset && !mintInfo) {
      return NextResponse.json(
        {
          error:
            "Token could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Small pause because free Helius
     * plans are easy to rate-limit.
     */
    await sleep(550);

    /*
     * Transactions touching the mint
     * account, newest -> oldest.
     */
    const signatures =
      await heliusRpc<
        SignatureInfo[]
      >(
        "getSignaturesForAddress",
        [
          mint,
          {
            limit: 1000,
            commitment:
              "confirmed",
          },
        ]
      );

    const oldestKnown =
      signatures.at(-1) ?? null;

    let creationTransaction:
      | ParsedTransaction
      | null = null;

    if (oldestKnown) {
      await sleep(550);

      creationTransaction =
        await heliusRpc<
          ParsedTransaction | null
        >(
          "getTransaction",
          [
            oldestKnown.signature,
            {
              encoding:
                "jsonParsed",

              commitment:
                "confirmed",

              maxSupportedTransactionVersion:
                1,
            },
          ]
        );
    }

    const earliestSigner =
      findProbableSigner(
        creationTransaction
      );

    const updateAuthority =
      asset.authorities?.[0]
        ?.address ?? null;

    const mintAuthority =
      mintInfo?.mintAuthority ??
      null;

    const freezeAuthority =
      mintInfo?.freezeAuthority ??
      null;

    /*
     * Prefer signer from earliest
     * mint transaction.
     *
     * Fall back to metadata/update
     * authority, then mint authority.
     */
    const probableCreator =
      earliestSigner ??
      updateAuthority ??
      mintAuthority ??
      null;

    let creatorSource:
      | "earliest-mint-transaction"
      | "update-authority"
      | "mint-authority"
      | "unknown" =
      "unknown";

    if (earliestSigner) {
      creatorSource =
        "earliest-mint-transaction";
    } else if (updateAuthority) {
      creatorSource =
        "update-authority";
    } else if (mintAuthority) {
      creatorSource =
        "mint-authority";
    }

    let creatorConfidence:
      | "high"
      | "medium"
      | "low"
      | "unknown" =
      "unknown";

    if (
      creatorSource ===
      "earliest-mint-transaction"
    ) {
      creatorConfidence =
        signatures.length < 1000
          ? "high"
          : "medium";
    } else if (
      creatorSource !== "unknown"
    ) {
      creatorConfidence =
        "low";
    }

    let creatorSol:
      | number
      | null = null;

    let creatorTokenBalance:
      | number
      | null = null;

    let recentActivity: Awaited<
      ReturnType<
        typeof getRecentActivity
      >
    > = [];

    if (probableCreator) {
      await sleep(550);

      const [
        balanceResult,
        tokenAccounts,
      ] = await Promise.all([
        heliusRpc<BalanceResult>(
          "getBalance",
          [
            probableCreator,
            {
              commitment:
                "confirmed",
            },
          ]
        ),

        heliusRpc<TokenAccountsResult>(
          "getTokenAccountsByOwner",
          [
            probableCreator,

            {
              mint,
            },

            {
              encoding:
                "jsonParsed",
            },
          ]
        ),
      ]);

      creatorSol =
        typeof balanceResult.value ===
        "number"
          ? balanceResult.value /
            1_000_000_000
          : null;

      creatorTokenBalance =
        tokenAccountBalance(
          tokenAccounts
        );

      await sleep(550);

      recentActivity =
        await getRecentActivity(
          probableCreator
        );
    }

    const decimals =
      asset.token_info?.decimals ??
      mintInfo?.decimals ??
      0;

    const rawSupplyValue =
      asset.token_info?.supply ??
      mintInfo?.supply ??
      null;

    const rawSupply =
      rawSupplyValue !== null
        ? Number(rawSupplyValue)
        : null;

    const supply =
      rawSupply !== null &&
      Number.isFinite(rawSupply)
        ? rawSupply /
          Math.pow(
            10,
            decimals
          )
        : null;

    const creatorPercent =
      creatorTokenBalance !== null &&
      supply !== null &&
      supply > 0
        ? (creatorTokenBalance /
            supply) *
          100
        : null;

    const createdAt =
      creationTransaction?.blockTime ??
      oldestKnown?.blockTime ??
      null;

    return NextResponse.json({
      mint,

      token: {
        name:
          asset.content?.metadata
            ?.name ??
          "Unknown Token",

        symbol:
          asset.content?.metadata
            ?.symbol ??
          "???",

        decimals,

        supply,

        priceUsd:
          asset.token_info
            ?.price_info
            ?.price_per_token ??
          null,

        interface:
          asset.interface ??
          null,
      },

      dev: {
        probableCreator,

        source:
          creatorSource,

        confidence:
          creatorConfidence,

        solBalance:
          creatorSol,

        tokenBalance:
          creatorTokenBalance,

        percentSupply:
          creatorPercent,

        createdAt,

        mintAuthority,

        freezeAuthority,

        updateAuthority,

        recentActivity,
      },

      analysis: {
        mintTransactionCountScanned:
          signatures.length,

        creatorIsInference:
          true,
      },
    });
  } catch (error) {
    console.error(
      "DEVWATCH error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "DEVWATCH failed.";

    const status =
      message.includes("429")
        ? 429
        : 500;

    return NextResponse.json(
      {
        error: message,
      },
      {
        status,
      }
    );
  }
}