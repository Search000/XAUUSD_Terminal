import { Router } from "express";

const router = Router();

router.get("/gold-price", async (req, res) => {
  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`Price feed responded ${response.status}`);
    const data = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta: {
            regularMarketPrice: number;
            chartPreviousClose: number;
            regularMarketDayHigh: number;
            regularMarketDayLow: number;
            regularMarketOpen: number;
            regularMarketVolume: number;
            regularMarketTime: number;
            fiftyTwoWeekHigh?: number;
            fiftyTwoWeekLow?: number;
            currency?: string;
          };
        }>;
        error?: string;
      };
    };

    const result = data.chart?.result?.[0];
    if (!result) {
      return res.status(503).json({ error: "No data from Yahoo Finance" });
    }

    const meta = result.meta;
    const change = meta.regularMarketPrice - meta.chartPreviousClose;
    const changePct = (change / meta.chartPreviousClose) * 100;

    return res.json({
      price: meta.regularMarketPrice,
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(3)),
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      open: meta.regularMarketOpen,
      prevClose: meta.chartPreviousClose,
      volume: meta.regularMarketVolume,
      timestamp: meta.regularMarketTime,
      currency: meta.currency ?? "USD",
    });
  } catch (err) {
    req.log?.error({ err }, "gold-price proxy error");
    return res.status(503).json({ error: "Failed to fetch gold price" });
  }
});

export default router;
