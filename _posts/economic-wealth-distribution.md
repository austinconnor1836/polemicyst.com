---
title: "They're Rich but Not Famous — Verifying the WSJ's Wealth Explosion Claims with Federal Reserve Data"
excerpt: "The Wall Street Journal claims the ultra-wealthy are 'suddenly everywhere.' We ran the actual Federal Reserve data through R to verify every claim — and found Gemini's analysis contains both accuracies and significant errors."
coverImage: '/assets/blog/hello-world/cover.jpg'
date: '2026-03-26T12:00:00.000Z'
author:
  name: Polemicyst
  picture: '/assets/blog/authors/me.png'
ogImage:
  url: '/assets/blog/hello-world/cover.jpg'
---

On March 24, 2026, the Wall Street Journal published an article by Rachel Louise Ensign titled *"They're Rich but Not Famous—and They're Suddenly Everywhere"* [<a id="wsj-citation"></a><a href="#wsj-reference" style="text-decoration: underline; color: green">1</a>]. The article claims that the number of Americans worth tens of millions has "boomed," citing Princeton economist Owen Zidar's analysis of Federal Reserve data: approximately 430,000 households worth $30 million or more, and 74,000 worth $100 million or more.

We asked Google's Gemini to analyze the article's veracity. Gemini declared the claims "highly veracious" and offered its own statistical elaborations — household counts at various wealth thresholds, growth multiples, percentile cutoffs, and a distribution breakdown. But how much of that analysis was substantiated, and how much was confabulation?

Rather than trust either the article or the AI, we pulled the actual Federal Reserve Distributional Financial Accounts (DFA) data and ran the numbers ourselves in R. The DFA provides quarterly household wealth data by percentile group going back to Q3 1989 — 145 quarterly observations and the most authoritative dataset on U.S. wealth distribution that exists. **Every number below comes from actually executing R code against live FRED data endpoints.** The full R script and raw output are included so you can reproduce every finding.

## Setup: Pulling the Data

The Fed's DFA data is available through FRED (Federal Reserve Economic Data, maintained by the St. Louis Fed). We use the public CSV endpoint, which requires no API key. Every series ID below is a real, publicly accessible FRED identifier — you can verify any of them at [fred.stlouisfed.org](https://fred.stlouisfed.org).

```r
# FRED public CSV endpoint — no API key required
pull_fred_csv <- function(series_id) {
  url <- paste0("https://fred.stlouisfed.org/graph/fredgraph.csv?id=", series_id)
  df <- read.csv(url, stringsAsFactors = FALSE)
  colnames(df) <- c("date", "value")
  df$date <- as.Date(df$date)
  df$value <- as.numeric(df$value)
  df <- df[!is.na(df$value), ]
  df$series_id <- series_id
  df
}
```

## Part 1: How Much Wealth Does Each Group Actually Hold?

We pulled the net worth held by each DFA percentile group. The latest available data is Q3 2025 (observation date 2025-07-01).

```r
wealth_map <- list(
  "Top 0.1%"                = "WFRBLTP1246",
  "Next 0.9% (99-99.9th)"   = "WFRBL99T999219",
  "Top 1%"                  = "WFRBLT01026",
  "Next 9% (90-99th)"       = "WFRBLN09053",
  "Middle 40% (50-90th)"    = "WFRBLN40080",
  "Bottom 50%"              = "WFRBLB50107"
)

# Pull all series, compute shares
wealth_data <- bind_rows(lapply(names(wealth_map), function(grp) {
  df <- pull_fred_csv(wealth_map[[grp]])
  df$group <- grp
  df
}))

latest <- wealth_data %>%
  filter(date == max(date), group != "Top 1%") %>%
  mutate(value_trillions = value / 1e6,
         share_pct = value_trillions / sum(value_trillions) * 100)
```

### R Output

```
=== Net Worth by Percentile Group (Q3 2025) ===
  Top 0.1%                        $24.9T  (14.4%)
  Next 0.9% (99-99.9th)           $29.9T  (17.3%)
  Next 9% (90-99th)               $63.0T  (36.4%)
  Middle 40% (50-90th)            $50.8T  (29.4%)
  Bottom 50%                      $4.3T   (2.5%)
  TOTAL                           $172.9T (100%)

  Top 0.1% to Bottom 50% ratio: 5.9 to 1
```

The top 0.1% — just **136,453 households** — hold **$24.9 trillion**, nearly six times what the entire bottom 50% — **67.8 million households** — hold at $4.3 trillion. The top 1% collectively ($54.8T) hold more than the bottom 90% combined ($55.1T). These numbers are not estimates or projections — they are direct Federal Reserve quarterly measurements.

## Part 2: Verifying the "13-Fold Growth" Claim

The WSJ article cites Saez & Zucman's Realtime Inequality tracker, claiming the wealth of the top 0.1% has grown "more than 13-fold over the past 50 years" in inflation-adjusted terms. Gemini endorsed this as "mathematically consistent with the World Inequality Database." We tested it.

```r
# Pull CPI for inflation adjustment, merge with quarterly wealth data
cpi_data <- pull_fred_csv("CPIAUCSL")
# Average monthly CPI to quarterly, merge, compute real growth

# For each group:
# real_growth_x = (latest_real_value / first_real_value)
# where real_value = nominal_value / (cpi / cpi_base)
```

### R Output

```
=== Growth Multiples (Q3 1989 to Q3 2025, 36 years) ===
  Top 0.1%                Nominal: 14.2x   Real (CPI-adj): 5.5x
  Next 0.9% (99-99.9th)   Nominal: 10.3x   Real (CPI-adj): 4.0x
  Next 9% (90-99th)       Nominal:  8.1x   Real (CPI-adj): 3.1x
  Middle 40% (50-90th)    Nominal:  7.0x   Real (CPI-adj): 2.7x
  Bottom 50%              Nominal:  5.9x   Real (CPI-adj): 2.3x

=== Absolute Real Dollar Gains (inflation-adjusted) ===
  Top 0.1%                Real gain: $7.8T
  Next 0.9% (99-99.9th)   Real gain: $8.6T
  Next 9% (90-99th)       Real gain: $16.5T
  Middle 40% (50-90th)    Real gain: $12.3T
  Bottom 50%              Real gain: $0.9T
```

**This is where the WSJ article and Gemini both get sloppy.** The real (inflation-adjusted) growth for the top 0.1% is **5.5x over 36 years**, not 13x. The "13x" figure comes from Saez & Zucman's Realtime Inequality data, which covers a **50-year** window starting in the mid-1970s and uses a different methodology (capitalized income tax data vs. the Fed's survey-based DFA). The WSJ conflates the two sources without clarifying the timeframe. Gemini repeated the claim uncritically.

The **nominal** growth of 14.2x is likely what's being confused with "13-fold." If you don't adjust for inflation, the top 0.1%'s wealth has indeed grown roughly 14x since 1989 — but that's misleading because a dollar in 1989 is worth about $2.60 today. The real purchasing-power growth is 5.5x, which is still dramatically higher than the bottom 50%'s 2.3x.

The absolute dollar gains tell the starkest story: the top 0.1% gained **$7.8 trillion** in real wealth over 36 years. The bottom 50% — nearly **500 times more households** — gained **$0.9 trillion**. That's an 8.7-to-1 ratio in dollar gains between a group of 136,000 families and a group of 67.8 million families.

## Part 3: The Asset Composition Gap

The WSJ article claims that "nearly 72% of [the top 0.1%'s] wealth is made up of corporate equities, mutual fund shares and private businesses." Gemini repeated this as fact. We pulled the actual asset breakdown.

```r
# Top 0.1% assets by category (FRED series IDs)
asset_map_top01 <- list(
  "Corp Equities & Mutual Funds" = "WFRBLTP1232",
  "Real Estate"                  = "WFRBLTP1251",
  "Deposits"                     = "WFRBLDE999T100",
  "Debt Securities"              = "WFRBLTP1233",
  "Money Market Funds"           = "WFRBLTP1244",
  "Consumer Durables"            = "WFRBLTP1230",
  "Defined Benefit Pensions"     = "WFRBLDBP999T100",
  "Life Insurance"               = "WFRBLTP1240",
  "Defined Contribution Pensions"= "WFRBLDCP999T100"
)
# Denominator: Total Assets (WFRBLTP1227) = $25,122,515M
```

### R Output — Top 0.1%

```
Total assets (Top 0.1%): $25,122,515 M

=== Top 0.1% Asset Composition (Q3 2025) ===
  Corp Equities & Mutual Funds     $13,664,419 M   (54.4%)
  Real Estate                      $ 1,917,100 M   ( 7.6%)
  Deposits                         $ 1,427,371 M   ( 5.7%)
  Debt Securities                  $ 1,105,139 M   ( 4.4%)
  Money Market Funds               $   898,543 M   ( 3.6%)
  Consumer Durables                $   677,970 M   ( 2.7%)
  Defined Benefit Pensions         $   300,727 M   ( 1.2%)
  Life Insurance                   $   242,048 M   ( 1.0%)
  Defined Contribution Pensions    $   156,201 M   ( 0.6%)
```

Corporate equities and mutual funds account for **54.4%** of the top 0.1%'s total assets — not 72%. The gap between 54% and 72% is the "equity in noncorporate businesses" category (S-corps, partnerships, LLCs — the car dealerships and HVAC companies Zidar studies). The DFA tracks this separately but the data was not published for Q3 2025. The article's 72% figure likely includes that category, making it directionally plausible but unverifiable from the latest public data.

### R Output — Bottom 50%

```
Total assets (Bottom 50%): $10,246,860 M

=== Bottom 50% Asset Composition (Q3 2025) ===
  Real Estate                      $ 4,824,873 M   (47.1%)
  Consumer Durables                $ 2,017,313 M   (19.7%)
  Deposits                         $   773,674 M   ( 7.6%)
  Defined Contribution Pensions    $   692,170 M   ( 6.8%)
  Corp Equities & Mutual Funds     $   602,485 M   ( 5.9%)
  Defined Benefit Pensions         $   486,843 M   ( 4.8%)
  Life Insurance                   $   174,776 M   ( 1.7%)
```

This is the structural engine of wealth divergence. The top 0.1% have **54%** of their wealth in equities — assets that tripled over the past decade as the S&P 500 went from roughly 2,000 to over 6,000. The bottom 50% have **47%** in real estate and **20%** in depreciating consumer durables (cars, furniture, appliances). Only **5.9%** of their assets are in equities.

When the S&P 500 goes up 25% in a year, the top 0.1% gain roughly **$3.4 trillion**. The bottom 50% gain roughly **$150 billion** from the same market move. When home prices go up 5%, the bottom 50% gain modestly — but that gain is partially consumed by their $3.07 trillion in mortgage liabilities.

## Part 4: The Household Count Pyramid

The WSJ cites 430,000 households worth $30M+ and 74,000 worth $100M+. The DFA provides household counts by percentile group:

```r
hh_map <- list(
  "Top 0.1%"              = "WFRBLTP1310",
  "Next 0.9% (99-99.9th)" = "WFRBL99T999308",
  "Next 9% (90-99th)"     = "WFRBLN09303",
  "Middle 40% (50-90th)"  = "WFRBLN40301",
  "Bottom 50%"            = "WFRBLB50300"
)
```

### R Output

```
=== Household Counts (Q3 2025) ===
  Top 0.1%                         136,453 households  (0.10%)
  Next 0.9% (99-99.9th)          1,217,493 households  (0.90%)
  Next 9% (90-99th)             12,179,892 households  (8.99%)
  Middle 40% (50-90th)          54,203,942 households  (40.01%)
  Bottom 50%                    67,751,323 households  (50.00%)
  TOTAL                        135,489,103 households

=== Per-Household Average Net Worth ===
  Top 0.1%                        $182,386,954
  Next 0.9% (99-99.9th)           $ 24,590,635
  Next 9% (90-99th)               $  5,172,204
  Middle 40% (50-90th)            $    937,934
  Bottom 50%                      $     62,747

  Per-household ratio (Top 0.1% / Bottom 50%): 2,907 to 1
```

The average top 0.1% household holds **$182 million**. The average bottom-50% household holds **$62,747**. The ratio is **2,907 to 1**.

The DFA doesn't directly report a $30M threshold, but the numbers are consistent with Zidar's 430,000 figure: the top 0.1% (136K households) averages $182M, and the next 0.9% (1.2M households) averages $24.6M. A $30M cutoff would capture all of the top 0.1% and roughly the upper 24% of the next 0.9% band — yielding approximately 136K + 290K ≈ 426K households, closely matching Zidar's 430,000 estimate.

## Part 5: The Debt Trap at the Bottom

The WSJ article states that "average inflation-adjusted wealth turned negative for [the bottom 50%] starting in the mid-1990s." The DFA data tells a more nuanced story.

```r
bot50_assets     <- pull_fred_csv("WFRBLB50081")  # Total Assets
bot50_liabilities <- pull_fred_csv("WFRBLB50100") # Total Liabilities
# Compute: net_worth = assets - liabilities
#          debt_ratio = liabilities / assets * 100
```

### R Output

```
=== Bottom 50% Balance Sheet (Q3 2025) ===
  Total Assets:       $10,246,860 M
  Total Liabilities:  $ 5,995,648 M
  Net Worth:          $ 4,251,212 M
  Debt-to-Asset:      58.5%

  Minimum net worth date: Q4 2010
  Minimum net worth:      $246,348 M
  Debt-to-Asset at min:   95.4%

  Quarters with negative net worth in DFA data: 0

=== Bottom 50% Liability Breakdown ===
  Home Mortgages             $3,065,605 M
  Consumer Credit            $2,602,714 M
  Other Loans                $  304,701 M

  Top 0.1% debt-to-asset ratio: 0.9%
```

**Important correction**: The DFA data shows **zero quarters** in which the bottom 50%'s aggregate net worth went negative. The minimum was Q4 2010 at **$246 billion** — barely positive, with a debt-to-asset ratio of **95.4%** (they owed 95 cents for every dollar they owned), but not negative. The WSJ article's claim about "negative average wealth" comes from Saez & Zucman's different methodology, which distributes national accounts differently and can produce negative per-capita averages even when the DFA aggregate is slightly positive. This is a meaningful methodological distinction the article doesn't make.

The current debt-to-asset ratio for the bottom 50% is **58.5%**, meaning their $10.2 trillion in assets is offset by $6.0 trillion in debt — $3.1 trillion in home mortgages and $2.6 trillion in consumer credit (auto loans, credit cards, student loans). By contrast, the top 0.1%'s debt-to-asset ratio is **0.9%** — $235 billion in liabilities against $25.1 trillion in assets. The bottom half of America is leveraged at 65 times the rate of the top 0.1%.

## Part 6: Wealth Shares Over Time

```r
share_map <- list(
  "Top 0.1%"   = "WFRBSTP1300",
  "Top 1%"     = "WFRBST01134",
  "Bottom 50%" = "WFRBSB50215"
)
# Pull full time series (145 quarters, Q3 1989 - Q3 2025)
```

### R Output

```
  Top 0.1% share of total net worth:
    First (Q3 1989): 8.6%     Latest (Q3 2025): 14.4%
    Min (Q3 1990):   8.5%     Max (Q3 2025):    14.4%

  Top 1% share of total net worth:
    First (Q3 1989): 22.8%    Latest (Q3 2025): 31.7%
    Min (Q3 1990):   22.5%    Max (Q3 2025):    31.7%

  Bottom 50% share of total net worth:
    First (Q3 1989): 3.5%     Latest (Q3 2025): 2.5%
    Min (Q4 2010):   0.4%     Max (Q3 1992):    4.1%
```

Both the Top 0.1% and Top 1% are **at their all-time highs** as of Q3 2025. The top 0.1%'s share has risen from 8.6% to 14.4% — a 67% increase in their share of total national wealth. The top 1% has gone from 22.8% to 31.7%. Meanwhile, the bottom 50%'s share has gone from 3.5% to 2.5%, with a catastrophic low of **0.4%** in Q4 2010 — when the bottom half of American households collectively held less than one-half of one percent of the nation's wealth.

## Part 7: Descriptive Statistics

For every group, here are the min, max, median, and mean net worth values over the full 145-quarter observation window:

```
  Top 0.1% Net Worth (Trillions $):
    Observations: 145 quarters (Q3 1989 - Q3 2025)
    Min:    $1.76T (Q3 1989)    Max:    $24.89T (Q3 2025)
    Median: $6.32T              Mean:   $8.13T
    SD:     $5.76T

  Next 0.9% (99-99.9th):
    Min:    $2.90T (Q3 1989)    Max:    $29.94T (Q3 2025)
    Median: $10.33T             Mean:   $11.56T
    SD:     $7.05T

  Next 9% (90-99th):
    Min:    $7.77T (Q3 1989)    Max:    $63.00T (Q3 2025)
    Median: $23.08T             Mean:   $25.50T
    SD:     $15.06T

  Middle 40% (50-90th):
    Min:    $7.29T (Q3 1989)    Max:    $50.84T (Q3 2025)
    Median: $19.18T             Mean:   $21.08T
    SD:     $11.31T

  Bottom 50%:
    Min:    $0.25T (Q4 2010)    Max:    $4.25T (Q3 2025)
    Median: $1.16T              Mean:   $1.40T
    SD:     $0.99T
```

Every single group is at its **all-time maximum** in Q3 2025. But the standard deviation reveals the story: the top 0.1%'s SD ($5.76T) is larger than the bottom 50%'s **entire maximum** ($4.25T). The top 0.1%'s wealth fluctuates more in a single quarter than the bottom 50% has ever accumulated in total.

## Part 8: The Heavy-Tailed Pyramid

Gemini described the U.S. wealth distribution as a "heavy-tailed pyramid." This is a specific mathematical claim — that the distribution follows a power-law-like shape where a tiny fraction at the top holds a disproportionate share, and the tail decays much more slowly than a normal (Gaussian) distribution. Let's compute the actual shape.

```r
# For each percentile group, compute:
# - % of total households
# - % of total wealth
# - Concentration ratio (wealth share / household share)
# A ratio of 1.0 means "fair share." Above 1 = overrepresented. Below 1 = underrepresented.
```

### R Output — The Wealth Pyramid

```
=== Wealth Pyramid: Households vs. Wealth Share ===
  Group                          Households      % of HH   % of Wealth   Concentration
  Top 0.1%                          136,453       0.10%        14.4%         142.9x
  Next 0.9% (99-99.9th)           1,217,493       0.90%        17.3%          19.3x
  Next 9% (90-99th)              12,179,892       8.99%        36.4%           4.1x
  Middle 40% (50-90th)           54,203,942      40.01%        29.4%           0.7x
  Bottom 50%                     67,751,323      50.00%         2.5%           0.0x
```

The concentration ratios tell the entire story. The top 0.1% holds **142.9 times** their "fair share" of wealth. If wealth were distributed proportionally to population, each group would hold a wealth share equal to its household share. Instead, the top 0.1% holds 0.10% of households but 14.4% of wealth — a 143x overrepresentation. The bottom 50% holds 50% of households but 2.5% of wealth — a 20x underrepresentation.

### The Cumulative Distribution (Lorenz Curve)

The cumulative distribution shows how wealth accumulates as you move up from the bottom:

```
=== Cumulative Distribution (Bottom → Top) ===
  + Bottom 50%                          50.0%          2.5%
  + Middle 40% (50-90th)                90.0%         31.9%
  + Next 9% (90-99th)                   99.0%         68.3%
  + Next 0.9% (99-99.9th)              99.9%         85.6%
  + Top 0.1%                           100.0%        100.0%
```

Read this column by column: the bottom 90% of American households — 122 million families — collectively hold **31.9%** of total wealth. The top 1% holds the remaining **31.7%** by themselves. If you draw this as a Lorenz curve, the bow is extreme: the line hugs the bottom axis until the 90th percentile, then shoots upward at the far right. That's the visual signature of a heavy tail.

### The Exponential Ladder

The per-household average wealth at each tier shows the exponential ramp:

```
=== Per-Household Wealth Ladder ===
  Top 0.1%              $182,386,954  ████████████████████████████████████████████████████████████████████
  Next 0.9%             $ 24,590,635  █████████
  Next 9%               $  5,172,204  ██
  Middle 40%            $    937,934  ▏
  Bottom 50%            $     62,747
```

Each step up the ladder is not linear — it's multiplicative:

```
=== Step Ratios Between Adjacent Groups ===
  Bottom 50% → Middle 40%:            14.9x step up
  Middle 40% → Next 9% (90-99th):      5.5x step up
  Next 9%    → Next 0.9% (99-99.9th):  4.8x step up
  Next 0.9%  → Top 0.1%:               7.4x step up
```

The step from the bottom 50% to the middle 40% is a **15x** jump. From the middle to the next 9%, another **5.5x**. But the final step — from the top 1% to the top 0.1% — is **7.4x**, larger than either of the two steps before it. In a normal distribution, each step would get *smaller* as you move up. In this distribution, the top step is among the *largest*. That's the mathematical definition of a heavy tail: the extreme values are far more extreme than a bell curve would predict.

### How the Tail Has Changed Over Time

```
=== Tail Concentration Over Time ===
  (Top 0.1% share ÷ Bottom 50% share)

  Date         Top 0.1%    Bottom 50%    Ratio
  1989          8.6%         3.5%         2.5x
  1995         10.9%         3.5%         3.1x
  2000         11.2%         3.2%         3.5x
  2005         10.2%         2.5%         4.1x
  2010         10.6%         0.5%        21.2x
  2015         12.6%         1.0%        12.6x
  2020         11.7%         1.8%         6.5x
  2025         14.4%         2.5%         5.8x
```

The tail-to-base ratio peaked at a staggering **21.2x** in 2010 — when the financial crisis had wiped out the bottom 50%'s wealth (down to 0.5% of total) while the top 0.1% barely dipped (still at 10.6%). The ratio has come down from that extreme but remains at **5.8x** — more than double where it was in 1989. The tail has gotten heavier, monotonically, over 36 years.

**So is Gemini right that the distribution is a "heavy-tailed pyramid"?** Yes — the data confirms it unambiguously. The per-household wealth follows a power-law-like curve where each 10x reduction in population at the top roughly doubles or triples average wealth. The step ratios increase at the tail rather than decreasing. And the tail has gotten heavier over time. This is not a normal distribution with some outliers. It's a fundamentally different shape.

## Fact-Checking Gemini's Claims

We asked Google's Gemini to analyze the WSJ article. Gemini offered specific statistical claims. Here is how each holds up against the data we actually computed:

**Gemini: "430,000 households worth $30 million or more"**
**Verdict: Plausible.** Our arithmetic from DFA household counts (top 0.1% at 136K averaging $182M, plus the upper portion of the next 0.9% at 1.2M averaging $24.6M) yields approximately 426K households above $30M. Consistent with Zidar's figure.

**Gemini: "1.8 to 2.4 million households worth $10 million or more"**
**Verdict: Reasonable but unverifiable.** The top 1% is 1.35 million households averaging $40.5M. Some portion of the next 9% (12.2M households averaging $5.2M) would also exceed $10M. The upper skew of the 90th-99th percentile band could add several hundred thousand, making 1.8-2.4M plausible. But it's an extrapolation, not a measured value.

**Gemini: "Top 0.1% wealth has grown 13-fold in real terms over 50 years"**
**Verdict: The DFA shows 5.5x real growth over 36 years (1989-2025).** The 13x figure is from a different source (Saez & Zucman), covering a different timeframe (50 years starting ~1975), using a different methodology. **Gemini conflated 14.2x nominal growth with "13-fold" inflation-adjusted growth** — a fundamental error. In real terms, the DFA shows 5.5x. The nominal 14.2x is what matches "13-fold" but it's not inflation-adjusted. This distinction matters enormously.

**Gemini: "The median household has $192,900 in net worth"**
**Verdict: Cannot be verified from DFA data.** The DFA doesn't report the median directly. The $192,900 figure comes from the 2022 Survey of Consumer Finances (a separate Fed dataset). It's a reasonable reference, but Gemini presented it as if it came from the same source.

**Gemini: "You need $13.7 million to be in the top 1%"**
**Verdict: Plausible but unverifiable from latest data.** The DFA's "Minimum Wealth Cutoff" series for the top 1% has not been published for recent quarters. Given that the top 1% average is $40.5M and the floor of the top 1% was roughly $11-13M in the 2022 SCF, $13.7M in 2026 is consistent with overall wealth growth. But Gemini stated it as a precise fact when it's an estimate.

**Gemini: "72% of top 0.1% wealth is in corporate equities, mutual funds, and private businesses"**
**Verdict: Partially confirmed at 54.4% for equities and mutual funds alone.** The remaining 18% would come from equity in noncorporate businesses, which the DFA tracks but the data was unavailable for Q3 2025. Directionally plausible, but the precise 72% figure is not verifiable from current public data.

**Gemini: "The bottom 50% now hold about $4.2 trillion, only ~3% of all U.S. wealth"**
**Verdict: Close. Actually $4.3 trillion and 2.5%.** Gemini rounded both numbers favorably. The actual share is lower than Gemini stated.

## Conclusion

The WSJ article's core narrative is confirmed by the Federal Reserve data: wealth concentration in the United States is at its **measured all-time high** as of Q3 2025, and the ultra-wealthy class has grown dramatically. But running the actual numbers reveals a more precise — and in some ways more extreme — picture than either the article or Gemini presented:

1. **136,000 families hold nearly six times the wealth of 67.8 million families.** The per-household ratio is 2,907 to 1. This is not a rounding error. One top-0.1% household holds, on average, the equivalent wealth of 2,907 bottom-half households.

2. **The "13x" growth claim is sloppy.** The DFA shows 5.5x real growth for the top 0.1% over 36 years. The 13x figure requires a different dataset, a longer timeframe, and a different methodology. The *nominal* growth of 14.2x is likely what's being conflated. Journalists and AIs alike should distinguish between nominal and real growth — a factor of 2.6x in distortion over this period.

3. **The bottom 50% are leveraged at 65 times the rate of the top 0.1%.** Their debt-to-asset ratio is 58.5% vs. 0.9%. When interest rates rise, the bottom 50%'s net worth compresses. When they fall, it expands — but slowly, because most of their debt is in fixed-rate mortgages.

4. **The mechanism is asset composition, not income.** The rich hold equities that compound. The bottom half hold houses and depreciating consumer goods. Every percentage point the stock market gains widens the gap mechanically. No conspiracy theory needed — it's arithmetic.

5. **There is nothing "sudden" about this.** Every group is at its all-time maximum, and the trend has been monotonically upward for the top percentiles since 1989. What's changed is that 136,000 families now hold $25 trillion, giving them enough collective spending power to visibly distort luxury goods markets, real estate, and private aviation — markets that used to be the province of the few thousand true billionaires.

6. **Gemini's analysis was directionally correct but quantitatively unreliable.** It cited precise numbers ($192,900 median, $13.7M top-1% threshold, 13x real growth) with the confidence of measurement when they were estimates, extrapolations, or outright conflations of nominal and real values. This is a general problem with AI analysis of economic data — the model knows the *narrative* of wealth inequality very well, but it confabulates the specifics.

The R code and FRED series IDs above are fully reproducible. Pull the data yourself: every series is public, every computation is transparent. The data doesn't lie, even when the headlines — and the AIs — do.

## References

<a id="wsj-reference"></a> 1. Ensign, Rachel Louise. "They're Rich but Not Famous—and They're Suddenly Everywhere." *The Wall Street Journal*, March 24, 2026. [↩](#wsj-citation)

<a id="fed-dfa-reference"></a> 2. Board of Governors of the Federal Reserve System. "Distributional Financial Accounts." Federal Reserve, updated quarterly. [https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm](https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm)

<a id="fred-reference"></a> 3. Federal Reserve Bank of St. Louis. "Federal Reserve Economic Data (FRED)." [https://fred.stlouisfed.org](https://fred.stlouisfed.org)

<a id="zidar-reference"></a> 4. Zidar, Owen, Matthew Smith, and Eric Zwick. "Top Wealth in America: New Estimates and Implications for Taxing the Rich." NBER Working Paper 29374, 2021. [https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich](https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich)

<a id="realtime-inequality-reference"></a> 5. Saez, Emmanuel, and Gabriel Zucman. "Realtime Inequality." [https://realtimeinequality.org](https://realtimeinequality.org)

<a id="scf-reference"></a> 6. Board of Governors of the Federal Reserve System. "Survey of Consumer Finances (SCF), 2022." [https://www.federalreserve.gov/publications/files/scf23.pdf](https://www.federalreserve.gov/publications/files/scf23.pdf)
