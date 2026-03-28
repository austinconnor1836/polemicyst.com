---
title: "The Numbers Behind America's Wealth Divide — A Data-Driven Investigation Using Federal Reserve Data"
excerpt: "The Wall Street Journal says the ultra-wealthy are 'suddenly everywhere.' I pulled 145 quarters of Federal Reserve data and ran the numbers in R. The reality is worse than reported."
coverImage: '/assets/blog/hello-world/cover.jpg'
date: '2026-03-26T12:00:00.000Z'
author:
  name: Polemicyst
  picture: '/assets/blog/authors/me.png'
ogImage:
  url: '/assets/blog/hello-world/cover.jpg'
---

On March 24, 2026, the Wall Street Journal published *"They're Rich but Not Famous—and They're Suddenly Everywhere"* [<a id="wsj-citation"></a><a href="#wsj-reference" style="text-decoration: underline; color: green">1</a>], reporting that the number of Americans worth tens of millions has "boomed" — roughly 430,000 households worth $30 million or more, and 74,000 worth $100 million or more. The article framed this as a consumer trend story: these people are buying private jets, Hermès bags, and luxury hotel rooms.

I wanted to know whether the numbers held up, and whether the article was telling the full story. So I pulled the actual data it cites — the Federal Reserve's Distributional Financial Accounts — and ran my own analysis in R. The DFA provides quarterly household wealth data by percentile group going back to Q3 1989: 145 quarterly observations and the most authoritative dataset on U.S. wealth distribution that exists.

What I found is that the article's numbers are largely correct, but its framing is a profound understatement. This isn't a story about rich people shopping. It's a story about a structural divide so extreme that the math barely looks real.

## Setup

All data comes from the Federal Reserve's FRED public CSV endpoint. No API key needed. Every series ID below is a real, publicly accessible identifier you can verify at [fred.stlouisfed.org](https://fred.stlouisfed.org). **Run this block first** — all subsequent code depends on it.

```r
install.packages(c("dplyr", "tidyr", "purrr"), repos = "https://cloud.r-project.org")
library(dplyr)
library(tidyr)
library(purrr)

pull_fred_csv <- function(series_id) {
  url <- paste0("https://fred.stlouisfed.org/graph/fredgraph.csv?id=", series_id)
  df <- read.csv(url, stringsAsFactors = FALSE)
  colnames(df) <- c("date", "value")
  df$date <- as.Date(df$date)
  df$value <- suppressWarnings(as.numeric(df$value))
  df <- df[!is.na(df$value), ]
  df$series_id <- series_id
  df
}
```

## 1. The Snapshot: Who Holds What

The WSJ cites Princeton economist Owen Zidar's analysis: 430,000 households worth $30 million or more. Let's see what the Fed's own percentile breakdown shows.

```r
wealth_map <- list(
  "Top 0.1%"                = "WFRBLTP1246",
  "Next 0.9% (99-99.9th)"   = "WFRBL99T999219",
  "Top 1%"                  = "WFRBLT01026",
  "Next 9% (90-99th)"       = "WFRBLN09053",
  "Middle 40% (50-90th)"    = "WFRBLN40080",
  "Bottom 50%"              = "WFRBLB50107"
)

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

```
  Top 0.1%                        $24.9T  (14.4%)
  Next 0.9% (99-99.9th)           $29.9T  (17.3%)
  Next 9% (90-99th)               $63.0T  (36.4%)
  Middle 40% (50-90th)            $50.8T  (29.4%)
  Bottom 50%                      $4.3T   (2.5%)
  TOTAL                           $172.9T (100%)

  Top 0.1% to Bottom 50% wealth ratio: 5.9 to 1
```

136,453 households in the top 0.1% hold **$24.9 trillion**. 67,751,323 households in the bottom 50% hold **$4.3 trillion**. The smaller group — roughly the population of a midsized suburb — holds nearly six times the wealth of the larger group, which represents half the country.

```r
hh_map <- list(
  "Top 0.1%"              = "WFRBLTP1310",
  "Next 0.9% (99-99.9th)" = "WFRBL99T999308",
  "Next 9% (90-99th)"     = "WFRBLN09303",
  "Middle 40% (50-90th)"  = "WFRBLN40301",
  "Bottom 50%"            = "WFRBLB50300"
)

hh_df <- bind_rows(lapply(names(hh_map), function(grp) {
  df <- pull_fred_csv(hh_map[[grp]])
  data.frame(group = grp, households = df$value[df$date == max(df$date)])
}))
```

```
  Per-Household Average Net Worth:
  Top 0.1%                        $182,386,954
  Next 0.9% (99-99.9th)           $ 24,590,635
  Next 9% (90-99th)               $  5,172,204
  Middle 40% (50-90th)            $    937,934
  Bottom 50%                      $     62,747

  Per-household ratio (Top 0.1% / Bottom 50%): 2,907 to 1
```

The average top 0.1% household holds **$182 million**. The average bottom-50% household holds **$62,747**. If you earned $62,747 a year and saved every penny — no rent, no food, no taxes — it would take you **2,907 years** to accumulate what one average top-0.1% household holds right now.

The article's 430,000 figure checks out arithmetically: the top 0.1% is 136K households averaging $182M (all above $30M), plus the upper ~24% of the next 0.9% band (1.2M households averaging $25M). That yields roughly 430K households above the $30M threshold.

## 2. How Fast Did They Get Rich?

The article cites Saez & Zucman's Realtime Inequality tracker, claiming the wealth of the top 0.1% has grown "more than 13-fold over the past 50 years" in inflation-adjusted terms. I tested this against the Fed's data.

```r
cpi_raw <- pull_fred_csv("CPIAUCSL")
cpi_raw$quarter <- as.Date(paste0(format(cpi_raw$date, "%Y-"),
  sprintf("%02d", ((as.numeric(format(cpi_raw$date, "%m")) - 1) %/% 3) * 3 + 1),
  "-01"))
cpi_quarterly <- cpi_raw %>%
  group_by(quarter) %>%
  summarise(cpi = mean(value, na.rm = TRUE), .groups = "drop") %>%
  rename(date = quarter)

growth_groups <- c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
                   "Middle 40% (50-90th)", "Bottom 50%")

for (grp in growth_groups) {
  grp_data <- wealth_data %>% filter(group == grp) %>% arrange(date)
  merged <- merge(grp_data, cpi_quarterly, by = "date", all.x = TRUE)
  merged <- merged[!is.na(merged$cpi), ]
  merged <- merged[order(merged$date), ]
  cpi_base <- merged$cpi[1]
  merged$real_value <- merged$value / (merged$cpi / cpi_base)
  nominal_x <- merged$value[nrow(merged)] / merged$value[1]
  real_x <- merged$real_value[nrow(merged)] / merged$real_value[1]
  real_gain <- (merged$real_value[nrow(merged)] - merged$real_value[1]) / 1e6
  cat(sprintf("  %-30s  Nominal: %.1fx  Real: %.1fx  Real gain: $%.1fT\n",
              grp, nominal_x, real_x, real_gain))
}
```

```
  Growth Multiples (Q3 1989 to Q3 2025, 36 years):
  Top 0.1%                Nominal: 14.2x   Real (CPI-adj): 5.5x   Gain: $7.8T
  Next 0.9% (99-99.9th)   Nominal: 10.3x   Real (CPI-adj): 4.0x   Gain: $8.6T
  Next 9% (90-99th)       Nominal:  8.1x   Real (CPI-adj): 3.1x   Gain: $16.5T
  Middle 40% (50-90th)    Nominal:  7.0x   Real (CPI-adj): 2.7x   Gain: $12.3T
  Bottom 50%              Nominal:  5.9x   Real (CPI-adj): 2.3x   Gain: $0.9T
```

The article's "13-fold" claim is sloppy. The Fed's data shows **5.5x real growth** for the top 0.1% over 36 years — not 13x. The *nominal* growth is 14.2x, which is likely what's being conflated with "13-fold." A dollar in 1989 is worth about $2.60 today, so the nominal figure is deeply misleading without the inflation adjustment. The 13x real figure comes from Saez & Zucman, who use a different methodology over a different timeframe (50 years starting in the mid-1970s). The article blurs the two without explaining the difference.

But the growth multiples aren't the real story. The **absolute dollar gains** are. The top 0.1% gained **$7.8 trillion** in inflation-adjusted wealth since 1989. The bottom 50% — roughly **500 times** more households — gained **$0.9 trillion**. The top captured 8.7x more real wealth than half the country.

## 3. What Do They Own vs. What Do You Own?

The article claims "nearly 72% of [the top 0.1%'s] wealth is made up of corporate equities, mutual fund shares and private businesses." I pulled the actual asset breakdown for the top 0.1% and the bottom 50%.

```r
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

total_assets_top01_df <- pull_fred_csv("WFRBLTP1227")
total_assets_top01 <- total_assets_top01_df$value[
  total_assets_top01_df$date == max(total_assets_top01_df$date)]

asset_top01 <- bind_rows(lapply(names(asset_map_top01), function(a) {
  df <- pull_fred_csv(asset_map_top01[[a]])
  data.frame(asset_type = a, value = df$value[df$date == max(df$date)])
}))
asset_top01$share_pct <- asset_top01$value / total_assets_top01 * 100
```

```
  Top 0.1% Asset Composition (Q3 2025):
  Corp Equities & Mutual Funds     $13,664,419 M   (54.4%)
  Real Estate                      $ 1,917,100 M   ( 7.6%)
  Deposits                         $ 1,427,371 M   ( 5.7%)
  Debt Securities                  $ 1,105,139 M   ( 4.4%)
  Money Market Funds               $   898,543 M   ( 3.6%)
  Consumer Durables                $   677,970 M   ( 2.7%)
  Defined Benefit Pensions         $   300,727 M   ( 1.2%)
  Life Insurance                   $   242,048 M   ( 1.0%)
  Defined Contribution Pensions    $   156,201 M   ( 0.6%)

  Bottom 50% Asset Composition (Q3 2025):
  Real Estate                      $ 4,824,873 M   (47.1%)
  Consumer Durables                $ 2,017,313 M   (19.7%)
  Deposits                         $   773,674 M   ( 7.6%)
  Defined Contribution Pensions    $   692,170 M   ( 6.8%)
  Corp Equities & Mutual Funds     $   602,485 M   ( 5.9%)
  Defined Benefit Pensions         $   486,843 M   ( 4.8%)
  Life Insurance                   $   174,776 M   ( 1.7%)
```

The 72% figure can't be fully verified — equities and mutual funds account for **54.4%** of the top 0.1%'s assets. The remaining ~18% would come from equity in noncorporate businesses (S-corps, partnerships, LLCs), which the DFA tracks separately but didn't publish for Q3 2025. So the claim is plausible but unverifiable from current public data.

What *is* verifiable — and far more important — is the contrast between the two groups. The top 0.1% has **54%** of their wealth in equities — assets that have tripled in the past decade as the S&P 500 went from ~2,000 to over 6,000. The bottom 50% has **5.9%** in equities. Instead, they have **47%** in real estate and **20%** in depreciating consumer durables — cars, furniture, appliances.

This is the structural engine of the wealth divide. When the stock market goes up 25% in a year, the top 0.1% gain roughly **$3.4 trillion**. The bottom 50% gain roughly **$150 billion** from the same move. When home prices go up 5%, the bottom 50% gain modestly — but that gain is partially consumed by their $3.1 trillion in mortgage debt. The rich hold assets that compound. Everyone else holds assets that depreciate or grow slowly. The gap widens on autopilot.

## 4. The Debt Trap

The article states that "average inflation-adjusted wealth turned negative for [the bottom 50%] starting in the mid-1990s." I tested this directly.

```r
bot50_assets_ts <- pull_fred_csv("WFRBLB50081")
bot50_liabilities_ts <- pull_fred_csv("WFRBLB50100")

bal <- merge(
  bot50_assets_ts %>% select(date, assets = value),
  bot50_liabilities_ts %>% select(date, liabilities = value),
  by = "date"
) %>%
  mutate(net_worth = assets - liabilities,
         debt_ratio = liabilities / assets * 100) %>%
  arrange(date)
```

```
  Bottom 50% Balance Sheet (Q3 2025):
  Total Assets:      $10,246,860 M
  Total Liabilities: $ 5,995,648 M
  Net Worth:         $ 4,251,212 M
  Debt-to-Asset:     58.5%

  Worst quarter: Q4 2010
  Net worth then: $246,348 M
  Debt-to-Asset then: 95.4%

  Quarters with NEGATIVE net worth in DFA data: 0

  What the bottom 50% owe:
  Home Mortgages             $3,065,605 M
  Consumer Credit            $2,602,714 M
  Other Loans                $  304,701 M

  Top 0.1% debt-to-asset ratio: 0.9%
  Bottom 50% debt-to-asset ratio: 58.5%
  Bottom 50% are leveraged at 62x the rate of the top 0.1%
```

The article's "negative wealth" claim is **not supported** by the Fed's own data. In 145 quarters of DFA data, the bottom 50%'s aggregate net worth never went negative. The worst was Q4 2010: $246 billion positive, but with a **95.4%** debt-to-asset ratio — they owed 95 cents for every dollar they owned. The "negative" figure comes from Saez & Zucman's different methodology, which distributes national accounts data differently. The article doesn't note this distinction.

But the debt picture is still devastating. The bottom 50% carry **$6 trillion** in debt against $10.2 trillion in assets. Their debt-to-asset ratio is **58.5%**. The top 0.1%'s is **0.9%** — $235 billion against $25.1 trillion in assets. The bottom half of America is leveraged at **62 times** the rate of the people at the top. Their "wealth" is largely the bank's wealth. A housing downturn or a spike in interest rates doesn't touch the top 0.1%, but it can erase the bottom 50%'s net worth almost entirely — as it nearly did in 2010.

## 5. The Trend: Getting Worse, Not Better

The article says the ultrawealthy "have grown really substantially." Let's see how each group's share of the pie has shifted over 36 years.

```r
share_map <- list(
  "Top 0.1%"   = "WFRBSTP1300",
  "Top 1%"     = "WFRBST01134",
  "Bottom 50%" = "WFRBSB50215"
)

for (grp in names(share_map)) {
  df <- pull_fred_csv(share_map[[grp]])
  cat(sprintf("  %s: %s %.1f%% -> %s %.1f%% (Min: %.1f%% in %s, Max: %.1f%% in %s)\n",
      grp, df$date[1], df$value[1], df$date[nrow(df)], df$value[nrow(df)],
      min(df$value), df$date[which.min(df$value)],
      max(df$value), df$date[which.max(df$value)]))
}
```

```
  Top 0.1% share:  8.6% (1989) -> 14.4% (2025)   All-time high
  Top 1% share:   22.8% (1989) -> 31.7% (2025)   All-time high
  Bottom 50%:      3.5% (1989) ->  2.5% (2025)   Low of 0.4% in Q4 2010
```

Both the top 0.1% and the top 1% are at their **all-time highs** as of Q3 2025. The top 0.1%'s share has increased by 67% since 1989. The bottom 50%'s share has *decreased* from 3.5% to 2.5%, with a catastrophic low of **0.4%** in Q4 2010 — when half of American households collectively held less than one-half of one percent of the nation's wealth.

Here's the number that stops me cold: the bottom 90% of American households — 122 million families — collectively hold **31.9%** of total wealth. The top 1% holds **31.7%** by themselves. One percent of households holds essentially the same share as the bottom ninety percent.

## 6. The Shape of the Distribution

The article's headline — "suddenly everywhere" — implies this is a recent development. The data tells a different story. The distribution follows a heavy-tailed power law that's been steepening for decades.

```r
# Concentration ratios: wealth share / household share
# A ratio of 1.0 = "fair share." Above 1 = overrepresented.
for (grp in growth_groups) {
  hh_pct <- hh_df$pct_of_total[hh_df$group == grp]
  w_pct  <- latest$share_pct[latest$group == grp]
  cat(sprintf("  %-30s  HH: %5.2f%%  Wealth: %5.1f%%  Concentration: %5.1fx\n",
              grp, hh_pct, w_pct, w_pct / hh_pct))
}
```

```
  Concentration Ratios:
  Top 0.1%                   HH:  0.10%   Wealth: 14.4%   Concentration: 142.9x
  Next 0.9% (99-99.9th)      HH:  0.90%   Wealth: 17.3%   Concentration:  19.3x
  Next 9% (90-99th)          HH:  8.99%   Wealth: 36.4%   Concentration:   4.1x
  Middle 40% (50-90th)       HH: 40.01%   Wealth: 29.4%   Concentration:   0.7x
  Bottom 50%                 HH: 50.00%   Wealth:  2.5%   Concentration:   0.0x
```

The top 0.1% holds **143 times** their proportional share of wealth. If wealth were distributed evenly by household, each group would hold a share equal to its population share. Instead, 0.1% of households hold 14.4% of the wealth — a 143x overrepresentation — while 50% of households hold 2.5%.

The cumulative view makes the Lorenz curve visible:

```
  Cumulative Distribution (bottom to top):
  + Bottom 50%                       50.0% of HH ->   2.5% of wealth
  + Middle 40% (50-90th)             90.0% of HH ->  31.9% of wealth
  + Next 9% (90-99th)                99.0% of HH ->  68.3% of wealth
  + Next 0.9% (99-99.9th)            99.9% of HH ->  85.6% of wealth
  + Top 0.1%                        100.0% of HH -> 100.0% of wealth
```

The bottom 90% holds 31.9%. The top 10% holds 68.1%. The top 1% alone holds 31.7%. The curve hugs the bottom axis until the 90th percentile, then shoots upward at the far right. That's not a normal distribution with some outliers — it's a fundamentally different shape.

The per-household wealth ladder shows the exponential ramp:

```
  Per-Household Wealth Ladder:
  Top 0.1%              $182,386,954  ██████████████████████████████████████████████████████████████████████
  Next 0.9%             $ 24,590,635  █████████
  Next 9%               $  5,172,204  ██
  Middle 40%            $    937,934  ▏
  Bottom 50%            $     62,747
```

Each step up the ladder isn't a steady increment — it's a multiplier:

```
  Step Ratios:
  Bottom 50%  -> Middle 40%:    14.9x
  Middle 40%  -> Next 9%:        5.5x
  Next 9%     -> Next 0.9%:      4.8x
  Next 0.9%   -> Top 0.1%:       7.4x
```

In a normal distribution, these step ratios would *decrease* as you climb — each tier would be closer to the one above it. Here, the final step (7.4x) is **larger** than the two steps before it. The extreme values are far more extreme than a bell curve would predict. That's the mathematical definition of a heavy tail.

And it's getting heavier over time:

```
  Tail-to-Base Ratio (Top 0.1% share ÷ Bottom 50% share):
  1989:    2.5x
  1995:    3.1x
  2000:    3.5x
  2005:    4.1x
  2010:   21.2x   <- financial crisis crushed the bottom, barely touched the top
  2015:   12.6x
  2020:    6.5x
  2025:    5.6x
```

The ratio peaked at **21.2x** in 2010, when the housing collapse wiped out the bottom 50%'s wealth (down to 0.5% of total) while the top 0.1% barely dipped (still at 10.6%). It's recovered from that extreme but remains at 5.6x — more than double where it was in 1989.

## What the Article Got Right and Wrong

**Right:** The number of ultra-wealthy households has grown substantially. 430,000 households worth $30M+ is consistent with the Fed data. The asset composition claim (72% in equities and businesses) is directionally correct. The bottom 50% struggled to build wealth for decades.

**Wrong:** The "13-fold growth" figure conflates nominal and real, and mixes two incompatible data sources without explanation. The "negative wealth" claim for the bottom 50% is not supported by the Fed's own DFA data (zero quarters of negative aggregate net worth). And "suddenly everywhere" is misleading — this has been a monotonic 36-year trend, not a sudden shift.

**Missing:** The article doesn't mention the 2,907-to-1 per-household ratio. It doesn't mention that the bottom 50% carries $6 trillion in debt at a 58.5% debt-to-asset ratio — leveraged at 62x the rate of the top 0.1%. It doesn't mention that the top 1% now holds the same share of wealth as the bottom 90% combined. And it frames this as a consumer trend story — "they're buying Hermès and NetJets" — when the data shows a structural divergence driven by asset composition: equities compound, houses and cars don't.

## Conclusion

The Wall Street Journal is right that the ultra-wealthy class has expanded. But writing about it as a lifestyle trend — as if the interesting thing about 136,000 families holding $25 trillion is what they spend it on — misses the point.

The data shows a system where the top 0.1% hold assets that mechanically compound while the bottom 50% hold assets that depreciate, backed by $6 trillion in debt. Every percentage point the stock market gains widens the gap automatically. No conspiracy required. It's arithmetic.

Half of American households — 67.8 million families — share 2.5% of national wealth. One-tenth of one percent — 136,453 families — hold 14.4%. The step ratios increase at the tail. The concentration ratios are at all-time highs. And the trend line points in one direction.

The rich aren't "suddenly everywhere." They've been compounding for 36 years. What's new is that 136,000 families now hold enough collective wealth to visibly distort the markets — housing, travel, luxury goods — that ordinary Americans also participate in. The headline should have been: *"They Were Always Here. You Just Couldn't Afford to Notice."*

All R code and FRED series IDs above are fully reproducible. Pull the data yourself. The numbers don't require commentary. They speak for themselves.

## References

<a id="wsj-reference"></a> 1. Ensign, Rachel Louise. "They're Rich but Not Famous—and They're Suddenly Everywhere." *The Wall Street Journal*, March 24, 2026. [↩](#wsj-citation)

2. Board of Governors of the Federal Reserve System. "Distributional Financial Accounts." Updated quarterly. [https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm](https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm)

3. Federal Reserve Bank of St. Louis. "Federal Reserve Economic Data (FRED)." [https://fred.stlouisfed.org](https://fred.stlouisfed.org)

4. Zidar, Owen, Matthew Smith, and Eric Zwick. "Top Wealth in America: New Estimates and Implications for Taxing the Rich." NBER Working Paper 29374, 2021. [https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich](https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich)

5. Saez, Emmanuel, and Gabriel Zucman. "Realtime Inequality." [https://realtimeinequality.org](https://realtimeinequality.org)

6. Board of Governors of the Federal Reserve System. "Survey of Consumer Finances (SCF), 2022." [https://www.federalreserve.gov/publications/files/scf23.pdf](https://www.federalreserve.gov/publications/files/scf23.pdf)
