"use client";

import {
  FormEvent,
  useState,
} from "react";

type ScanTab =
  | "devwatch"
  | "buyers"
  | "exit";

type RecentActivity = {
  signature: string | null;
  type: string;
  description: string;
  timestamp: number | null;
  fee: number | null;
};

type DevwatchData = {
  mint: string;

  token: {
    name: string;
    symbol: string;
    decimals: number;
    supply: number | null;
    priceUsd: number | null;
    interface: string | null;
  };

  dev: {
    probableCreator: string | null;
    source: string;
    confidence: string;

    solBalance: number | null;
    tokenBalance: number | null;
    percentSupply: number | null;

    createdAt: number | null;

    mintAuthority: string | null;
    freezeAuthority: string | null;
    updateAuthority: string | null;

    recentActivity: RecentActivity[];
  };

  analysis: {
    mintTransactionCountScanned: number;
    creatorIsInference: boolean;
  };
};

type FlowWindow = {
  buys: number;
  sells: number;
  total: number;
  buySharePct: number | null;
};

type FlowData = {
  mint: string;

  referencePair: {
    dex: string;

    pairAddress: string | null;

    baseSymbol: string | null;
    quoteSymbol: string | null;

    priceUsd: number | null;
    liquidityUsd: number | null;

    marketCap: number | null;
    fdv: number | null;

    pairCreatedAt: number | null;
  };

  flow: {
    m5: FlowWindow;
    h1: FlowWindow;
    h6: FlowWindow;
    h24: FlowWindow;
  };

  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };

  priceChange: {
    m5: number | null;
    h1: number | null;
    h6: number | null;
    h24: number | null;
  };

  verdict: string;
  pairCount: number;
  note: string;
};

type ExitData = {
  mint: string;

  positionUsd: number;

  tokenPriceUsd: number;

  tokensIn?: number;

  market: {
    dex: string;
  };

  routeAvailable: boolean;

  estimatedReceiveUsd: number | null;

  priceImpactPct: number | null;

  rating: string;

  output?: string;

  error?: string;

  note?: string;
};

const tabs: {
  id: ScanTab;
  label: string;
  subtitle: string;
}[] = [
  {
    id: "devwatch",
    label: "DEVWATCH",
    subtitle: "Who launched it?",
  },
  {
    id: "buyers",
    label: "BUY FLOW",
    subtitle: "Buyers vs sellers",
  },
  {
    id: "exit",
    label: "EXIT",
    subtitle: "Can you get out?",
  },
];

export default function Home() {
  const [
    contract,
    setContract,
  ] = useState("");

  const [
    activeTab,
    setActiveTab,
  ] =
    useState<ScanTab>(
      "devwatch"
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    devwatch,
    setDevwatch,
  ] =
    useState<
      DevwatchData | null
    >(null);

  const [
    flow,
    setFlow,
  ] =
    useState<
      FlowData | null
    >(null);

  const [
    flowError,
    setFlowError,
  ] = useState("");

  const [
    exitAmount,
    setExitAmount,
  ] = useState("500");

  const [
    exitData,
    setExitData,
  ] =
    useState<
      ExitData | null
    >(null);

  const [
    exitLoading,
    setExitLoading,
  ] = useState(false);

  const [
    exitError,
    setExitError,
  ] = useState("");

  async function calculateExit() {
    if (!devwatch) {
      return;
    }

    const amount =
      Number(exitAmount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setExitError(
        "ENTER A VALID POSITION SIZE."
      );

      return;
    }

    try {
      setExitLoading(true);
      setExitError("");
      setExitData(null);

      const response =
        await fetch(
          `/api/exit?mint=${encodeURIComponent(
            devwatch.mint
          )}&amount=${encodeURIComponent(
            String(amount)
          )}`,
          {
            cache:
              "no-store",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "EXIT SCAN FAILED."
        );
      }

      setExitData(
        data as ExitData
      );
    } catch (err) {
      setExitError(
        err instanceof Error
          ? err.message
          : "EXIT SCAN FAILED."
      );
    } finally {
      setExitLoading(false);
    }
  }

  function selectTab(
    tab: ScanTab
  ) {
    setActiveTab(tab);
  }

  async function handleScan(
    event: FormEvent
  ) {
    event.preventDefault();

    const mint =
      contract.trim();

    if (!mint) {
      setError(
        "PASTE A CONTRACT ADDRESS."
      );

      return;
    }

    if (
      mint.length < 32 ||
      mint.length > 44
    ) {
      setError(
        "INVALID SOLANA ADDRESS."
      );

      return;
    }

    try {
      setError("");
      setFlowError("");
      setExitError("");

      setLoading(true);

      setDevwatch(null);
      setFlow(null);
      setExitData(null);

      const [
        devResponse,
        flowResponse,
      ] =
        await Promise.all([
          fetch(
            `/api/devwatch?mint=${encodeURIComponent(
              mint
            )}`,
            {
              cache:
                "no-store",
            }
          ),

          fetch(
            `/api/buyers?mint=${encodeURIComponent(
              mint
            )}`,
            {
              cache:
                "no-store",
            }
          ),
        ]);

      const [
        devData,
        flowData,
      ] =
        await Promise.all([
          devResponse.json(),
          flowResponse.json(),
        ]);

      if (!devResponse.ok) {
        throw new Error(
          devData.error ??
            "DEVWATCH FAILED."
        );
      }

      setDevwatch(
        devData as DevwatchData
      );

      if (flowResponse.ok) {
        setFlow(
          flowData as FlowData
        );
      } else {
        setFlowError(
          flowData.error ??
            "BUY FLOW FAILED."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "SCAN FAILED."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="scan-app">
      <header className="nav">
        <button
          type="button"
          className="logo"
        >
          <span className="logo-box">
            S
          </span>

          SCAN
        </button>

        <div className="nav-status">
          <span className="green-dot" />

          SOLANA MAINNET

          <span className="beta">
            BETA
          </span>
        </div>
      </header>

      <section className="main-shell">
        <div className="intro">
          <div>
            <p className="kicker">
              SOLANA TOKEN
              INTELLIGENCE
            </p>

            <h1>
              SCAN THE TOKEN.
              <br />

              <span>
                KNOW THE PLAY.
              </span>
            </h1>
          </div>

          <p className="intro-copy">
            DEV ACTIVITY /
            BUY FLOW / EXIT
            LIQUIDITY
          </p>
        </div>

        <form
          className="search"
          onSubmit={
            handleScan
          }
        >
          <span className="search-label">
            CA
          </span>

          <input
            value={contract}
            onChange={(e) =>
              setContract(
                e.target.value
              )
            }
            placeholder="PASTE SOLANA CONTRACT ADDRESS"
            spellCheck={false}
            autoComplete="off"
          />

          <button
            disabled={loading}
          >
            {loading
              ? "SCANNING..."
              : "SCAN →"}
          </button>
        </form>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <div className="module-tabs">
          {tabs.map(
            (
              tab,
              index
            ) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  selectTab(
                    tab.id
                  )
                }
                className={
                  activeTab ===
                  tab.id
                    ? "module active"
                    : "module"
                }
              >
                <span className="module-number">
                  0{index + 1}
                </span>

                <div>
                  <strong>
                    {tab.label}
                  </strong>

                  <small>
                    {tab.subtitle}
                  </small>
                </div>

                <span className="module-arrow">
                  ↗
                </span>
              </button>
            )
          )}
        </div>

        <section className="screen">
          <div className="screen-top">
            <div>
              <span
                className={`screen-light ${
                  loading ||
                  exitLoading
                    ? "pulse"
                    : ""
                }`}
              />

              <strong>
                {
                  tabs.find(
                    (tab) =>
                      tab.id ===
                      activeTab
                  )?.label
                }
              </strong>
            </div>

            <span>
              {loading
                ? "SCANNING CHAIN..."
                : exitLoading
                  ? "QUOTING EXIT..."
                  : devwatch
                    ? "LIVE DATA"
                    : "WAITING FOR TOKEN"}
            </span>
          </div>

          {loading && (
            <div className="empty-screen">
              <div className="scanner-line" />

              <p>
                READING ON-CHAIN
                ACTIVITY...
              </p>
            </div>
          )}

          {!loading &&
            !devwatch && (
              <div className="empty-screen">
                <div className="target">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>

                <h2>
                  NO TARGET
                </h2>

                <p>
                  PASTE A TOKEN
                  CONTRACT ABOVE.
                </p>
              </div>
            )}

          {!loading &&
            devwatch && (
              <>
                <div className="token-header">
                  <div>
                    <p>
                      TARGET TOKEN
                    </p>

                    <h2>
                      $
                      {
                        devwatch
                          .token
                          .symbol
                      }

                      <span>
                        {
                          devwatch
                            .token
                            .name
                        }
                      </span>
                    </h2>
                  </div>

                  <div className="ca">
                    {shorten(
                      devwatch.mint
                    )}
                  </div>
                </div>

                {activeTab ===
                  "devwatch" && (
                    <DevwatchPanel
                      data={devwatch}
                    />
                  )}

                {activeTab ===
                  "buyers" && (
                    <FlowPanel
                      data={flow}
                      error={
                        flowError
                      }
                    />
                  )}

                {activeTab ===
                  "exit" && (
                    <ExitPanel
                      amount={
                        exitAmount
                      }
                      setAmount={
                        setExitAmount
                      }
                      calculate={
                        calculateExit
                      }
                      data={
                        exitData
                      }
                      loading={
                        exitLoading
                      }
                      error={
                        exitError
                      }
                    />
                  )}
              </>
            )}
        </section>
      </section>

      <footer>
        <span>
          SCAN // SOLANA
          INTELLIGENCE
        </span>

        <span>
          VERIFY EVERYTHING.
        </span>
      </footer>
    </main>
  );
}

function DevwatchPanel({
  data,
}: {
  data: DevwatchData;
}) {
  const dev = data.dev;

  return (
    <div className="data-section">
      <div className="stats">
        <Stat
          label="CREATOR CANDIDATE"
          value={
            dev.probableCreator
              ? shorten(
                  dev.probableCreator
                )
              : "UNKNOWN"
          }
        />

        <Stat
          label="SOL BALANCE"
          value={
            dev.solBalance !== null
              ? `${formatNumber(
                  dev.solBalance,
                  3
                )} SOL`
              : "—"
          }
        />

        <Stat
          label="TOKEN HELD"
          value={
            dev.tokenBalance !== null
              ? `${formatCompact(
                  dev.tokenBalance
                )}${
                  dev.percentSupply !==
                  null
                    ? ` / ${formatNumber(
                        dev.percentSupply,
                        2
                      )}%`
                    : ""
                }`
              : "—"
          }
        />

        <Stat
          label="LAST ACTION"
          value={
            dev.recentActivity[0]
              ? `${
                  dev
                    .recentActivity[0]
                    .type
                } / ${timeAgo(
                  dev
                    .recentActivity[0]
                    .timestamp
                )}`
              : "NO DATA"
          }
        />
      </div>

      <div className="intel-row">
        <Intel
          label="INFERENCE CONFIDENCE"
          value={
            dev.confidence.toUpperCase()
          }
        />

        <Intel
          label="SOURCE"
          value={sourceLabel(
            dev.source
          )}
        />

        <Intel
          label="MINT AUTHORITY"
          value={
            dev.mintAuthority
              ? "ACTIVE"
              : "REVOKED"
          }
        />

        <Intel
          label="FREEZE AUTHORITY"
          value={
            dev.freezeAuthority
              ? "ACTIVE"
              : "REVOKED"
          }
        />

        <Intel
          label="CREATED"
          value={formatDate(
            dev.createdAt
          )}
        />
      </div>

      <div className="warning">
        CREATOR CANDIDATE IS
        INFERRED FROM ON-CHAIN
        ACTIVITY. IT IS NOT
        GUARANTEED TO BE THE
        PROJECT&apos;S CURRENT
        OPERATOR OR CONTROLLER.
      </div>
    </div>
  );
}

function FlowPanel({
  data,
  error,
}: {
  data: FlowData | null;
  error: string;
}) {
  if (error) {
    return (
      <Placeholder
        title="BUY FLOW FAILED"
        body={error}
      />
    );
  }

  if (!data) {
    return (
      <Placeholder
        title="NO FLOW DATA"
        body="NO REFERENCE MARKET DATA FOUND."
      />
    );
  }

  return (
    <div className="data-section">
      <div className="stats">
        <Stat
          label="5M BUYS / SELLS"
          value={`${data.flow.m5.buys} / ${data.flow.m5.sells}`}
        />

        <Stat
          label="1H BUYS / SELLS"
          value={`${data.flow.h1.buys} / ${data.flow.h1.sells}`}
        />

        <Stat
          label="24H VOLUME"
          value={formatUsdCompact(
            data.volume.h24
          )}
        />

        <Stat
          label="1H BUY COUNT SHARE"
          value={
            data.flow.h1
              .buySharePct !== null
              ? `${formatNumber(
                  data.flow.h1
                    .buySharePct,
                  1
                )}%`
              : "—"
          }
        />
      </div>

      <div className="intel-row">
        <Intel
          label="LIQUIDITY"
          value={
            data.referencePair
              .liquidityUsd !== null
              ? formatUsdCompact(
                  data.referencePair
                    .liquidityUsd
                )
              : "UNKNOWN"
          }
        />

        <Intel
          label="MARKET CAP"
          value={
            data.referencePair
              .marketCap !== null
              ? formatUsdCompact(
                  data.referencePair
                    .marketCap
                )
              : "UNKNOWN"
          }
        />

        <Intel
          label="REFERENCE DEX"
          value={
            data.referencePair.dex.toUpperCase()
          }
        />

        <Intel
          label="24H BUYS / SELLS"
          value={`${data.flow.h24.buys} / ${data.flow.h24.sells}`}
        />

        <Intel
          label="FLOW VERDICT"
          value={data.verdict}
        />
      </div>

      <div className="warning">
        BUY FLOW USES THE
        HIGHEST-LIQUIDITY
        REFERENCE PAIR FOUND
        FOR THIS TOKEN.
        BUY/SELL VALUES ARE
        TRANSACTION COUNTS,
        NOT UNIQUE WALLET
        COUNTS.
      </div>
    </div>
  );
}

function ExitPanel({
  amount,
  setAmount,
  calculate,
  data,
  loading,
  error,
}: {
  amount: string;

  setAmount:
    React.Dispatch<
      React.SetStateAction<string>
    >;

  calculate: () => void;

  data: ExitData | null;

  loading: boolean;

  error: string;
}) {
  return (
    <div className="data-section">
      <div
        className="search"
        style={{
          margin: "18px",
        }}
      >
        <span className="search-label">
          POSITION $
        </span>

        <input
          value={amount}
          onChange={(e) =>
            setAmount(
              e.target.value.replace(
                /[^0-9.]/g,
                ""
              )
            )
          }
          placeholder="500"
          inputMode="decimal"
        />

        <button
          type="button"
          onClick={calculate}
          disabled={loading}
        >
          {loading
            ? "CALCULATING..."
            : "CALCULATE EXIT →"}
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {!data &&
        !loading && (
          <Placeholder
            title="YOUR POSITION"
            body="ENTER THE APPROXIMATE USD VALUE OF YOUR POSITION ABOVE."
          />
        )}

      {loading && (
        <div className="empty-screen">
          <div className="scanner-line" />

          <p>
            QUOTING LIVE SELL
            ROUTE...
          </p>
        </div>
      )}

      {data &&
        !loading && (
          <>
            <div className="stats">
              <Stat
                label="YOUR POSITION"
                value={formatUsd(
                  data.positionUsd
                )}
              />

              <Stat
                label="EST. RECEIVE"
                value={
                  data.routeAvailable &&
                  data.estimatedReceiveUsd !==
                    null
                    ? formatUsd(
                        data.estimatedReceiveUsd
                      )
                    : "NO ROUTE"
                }
              />

              <Stat
                label="PRICE IMPACT"
                value={
                  data.priceImpactPct !==
                  null
                    ? `${formatNumber(
                        data.priceImpactPct,
                        2
                      )}%`
                    : "—"
                }
              />

              <Stat
                label="EXIT RATING"
                value={
                  data.rating
                }
              />
            </div>

            <div className="intel-row">
              <Intel
                label="TOKEN PRICE"
                value={formatUsd(
                  data.tokenPriceUsd
                )}
              />

              <Intel
                label="MARKET"
                value={
                  data.market.dex.toUpperCase()
                }
              />

              <Intel
                label="ROUTE"
                value="TOKEN → USDC"
              />

              <Intel
                label="QUOTE STATUS"
                value={
                  data.routeAvailable
                    ? "LIVE ROUTE"
                    : "NO ROUTE"
                }
              />

              <Intel
                label="OUTPUT"
                value="USDC"
              />
            </div>

            <div className="warning">
              YOUR POSITION VALUE IS
              APPROXIMATED USING THE
              CURRENT REFERENCE PRICE.
              EST. RECEIVE IS WHAT THE
              CURRENT LIVE JUPITER ROUTE
              ESTIMATES YOU COULD RECEIVE
              IN USDC FOR THAT TOKEN
              AMOUNT. THIS IS NOT A FEE
              OR GUARANTEED LOSS. PRICES,
              ROUTING, AND PRICE IMPACT
              CAN CHANGE BEFORE
              EXECUTION.
            </div>
          </>
        )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Intel({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="intel">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Placeholder({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function shorten(
  value: string
) {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(
    0,
    7
  )}...${value.slice(-7)}`;
}

function formatNumber(
  value: number,
  decimals = 2
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits:
        decimals,
    }
  ).format(value);
}

function formatCompact(
  value: number
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      notation: "compact",
      maximumFractionDigits:
        2,
    }
  ).format(value);
}

function formatUsdCompact(
  value: number
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits:
        2,
    }
  ).format(value);
}

function formatUsd(
  value: number
) {
  const absolute =
    Math.abs(value);

  if (absolute < 0.01) {
    return `$${absolute.toPrecision(
      4
    )}`;
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      maximumFractionDigits:
        2,
    }
  ).format(absolute);
}

function formatDate(
  timestamp:
    | number
    | null
) {
  if (!timestamp) {
    return "UNKNOWN";
  }

  return new Date(
    timestamp * 1000
  )
    .toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      }
    )
    .toUpperCase();
}

function timeAgo(
  timestamp:
    | number
    | null
) {
  if (!timestamp) {
    return "UNKNOWN";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        Date.now() /
          1000 -
          timestamp
      )
    );

  if (seconds < 60) {
    return `${seconds}S AGO`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes}M AGO`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours}H AGO`;
  }

  return `${Math.floor(
    hours / 24
  )}D AGO`;
}

function sourceLabel(
  source: string
) {
  if (
    source ===
    "earliest-mint-transaction"
  ) {
    return "EARLIEST MINT TX";
  }

  if (
    source ===
    "update-authority"
  ) {
    return "UPDATE AUTHORITY";
  }

  if (
    source ===
    "mint-authority"
  ) {
    return "MINT AUTHORITY";
  }

  return "UNKNOWN";
}