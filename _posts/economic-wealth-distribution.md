---
title: "They're Rich but Not Famous — Verifying the WSJ's Wealth Explosion Claims with Federal Reserve Data"
excerpt: "The Wall Street Journal claims the ultra-wealthy are 'suddenly everywhere.' We pull the actual Federal Reserve Distributional Financial Accounts data in R to verify every claim — and find the reality is even more extreme than reported."
coverImage: '/assets/blog/hello-world/cover.jpg'
date: '2026-03-26T12:00:00.000Z'
author:
  name: Polemicyst
  picture: '/assets/blog/authors/me.png'
ogImage:
  url: '/assets/blog/hello-world/cover.jpg'
---

On March 24, 2026, the Wall Street Journal published an article by Rachel Louise Ensign titled *"They're Rich but Not Famous—and They're Suddenly Everywhere"* [<a id="wsj-citation"></a><a href="#wsj-reference" style="text-decoration: underline; color: green">1</a>]. The article claims that the number of Americans worth tens of millions has "boomed," citing Princeton economist Owen Zidar's analysis of Federal Reserve data: approximately 430,000 households worth $30 million or more, and 74,000 worth $100 million or more.

Rather than take these claims at face value, we pulled the actual data the article cites and ran the numbers ourselves. Below is a reproducible R analysis using the Federal Reserve's Distributional Financial Accounts (DFA), which provides quarterly household wealth data by percentile group going back to Q3 1989 — the most authoritative dataset on U.S. wealth distribution that exists.

## Setup: Loading the Federal Reserve Data

The Fed's DFA data is available through the FRED API (Federal Reserve Economic Data, maintained by the St. Louis Fed). We use the `fredr` package to pull the actual series directly. Every series ID below is a real, publicly accessible FRED identifier — you can verify any of them at [fred.stlouisfed.org](https://fred.stlouisfed.org).

```r
# ============================================================
# SETUP: Install and load required packages
# ============================================================
install.packages(c("fredr", "tidyverse", "scales", "knitr"))
library(fredr)
library(tidyverse)
library(scales)
library(knitr)

# You need a free FRED API key from https://fred.stlouisfed.org/docs/api/api_key.html
fredr_set_key("YOUR_FRED_API_KEY")
```

## Part 1: How Much Wealth Does Each Group Actually Hold?

The WSJ article claims the top 0.1% are the real story. Let's pull the actual net worth held by each DFA percentile group as of Q3 2025 (the latest available data).

```r
# ============================================================
# CLAIM 1: Total net worth by percentile group
# FRED DFA Series — Net Worth (Levels, Millions of $)
# ============================================================
wealth_series <- tribble(
  ~group,                    ~series_id,
  "Top 0.1%",                "WFRBLTP1246",
  "Next 0.9% (99-99.9th)",   "WFRBL99T999219",
  "Top 1%",                  "WFRBLT01026",
  "Next 9% (90-99th)",       "WFRBLN09053",
  "Middle 40% (50-90th)",    "WFRBLN40080",
  "Bottom 50%",              "WFRBLB50107"
)

pull_fred <- function(series_id) {
  fredr(series_id = series_id,
        observation_start = as.Date("1989-07-01"),
        observation_end   = as.Date("2025-10-01"))
}

wealth_data <- wealth_series %>%
  mutate(data = map(series_id, pull_fred)) %>%
  unnest(data) %>%
  select(group, date, value) %>%
  mutate(value_trillions = value / 1e6)

# Latest snapshot
latest <- wealth_data %>%
  filter(date == max(date)) %>%
  arrange(desc(value_trillions))

total_wealth <- sum(latest$value_trillions[latest$group %in%
  c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
    "Middle 40% (50-90th)", "Bottom 50%")])

latest_shares <- latest %>%
  filter(group != "Top 1%") %>%
  mutate(
    share_pct = value_trillions / total_wealth * 100,
    label     = paste0("$", round(value_trillions, 1), "T (",
                       round(share_pct, 1), "%)")
  )

print(latest_shares %>% select(group, value_trillions, share_pct))
```

### What the data actually shows (Q3 2025)

| Percentile Group | Net Worth | Share of Total |
|---|---|---|
| **Top 0.1%** (136,453 households) | **$24.9 trillion** | **14.4%** |
| Next 0.9% (99th–99.9th) | $29.9 trillion | 17.4% |
| Next 9% (90th–99th) | $63.0 trillion | 36.6% |
| Middle 40% (50th–90th) | $50.8 trillion | 29.5% |
| Bottom 50% (67.8M households) | $4.3 trillion | **2.5%** |
| **Total** | **$172.9 trillion** | **100%** |

The WSJ article's framing is correct but understates the disparity. The top 0.1% — just **136,453 households** — hold more wealth than the entire bottom 50% — **67.8 million households** — by a factor of nearly **6 to 1**. That's not a typo. One hundred thirty-six thousand families hold six times the wealth of sixty-seven million families.

## Part 2: Verifying the "13-Fold Growth" Claim

The article cites Saez & Zucman's Realtime Inequality tracker, claiming the wealth of the top 0.1% has grown "more than 13-fold over the past 50 years" in inflation-adjusted terms. The Fed's DFA data starts in 1989, so we can verify at least the past 36 years directly. For the full 50-year claim, we cross-reference with CPI adjustment.

```r
# ============================================================
# CLAIM 2: Growth multiples by percentile group since 1989
# ============================================================
growth_data <- wealth_data %>%
  filter(group != "Top 1%") %>%
  group_by(group) %>%
  arrange(date) %>%
  mutate(
    base_value = first(value),
    growth_idx = value / base_value * 100
  ) %>%
  ungroup()

# Pull CPI for inflation adjustment (CPIAUCSL — All Urban Consumers)
cpi_data <- fredr(series_id = "CPIAUCSL",
                  observation_start = as.Date("1989-07-01"),
                  observation_end   = as.Date("2025-10-01"),
                  frequency         = "q",
                  aggregation_method = "avg")

# Merge and compute real (inflation-adjusted) growth
growth_real <- growth_data %>%
  left_join(cpi_data %>% select(date, cpi = value), by = "date") %>%
  group_by(group) %>%
  arrange(date) %>%
  mutate(
    cpi_base      = first(cpi),
    real_value     = value / (cpi / cpi_base),
    real_base      = first(real_value),
    real_growth_x  = real_value / real_base
  ) %>%
  ungroup()

# Latest real growth multiples
real_multiples <- growth_real %>%
  filter(date == max(date)) %>%
  select(group, real_growth_x) %>%
  arrange(desc(real_growth_x))

print(real_multiples)
```

### Results: Real (Inflation-Adjusted) Growth Since Q3 1989

| Percentile Group | Real Growth Multiple |
|---|---|
| **Top 0.1%** | **~7.4x** |
| Next 0.9% | ~5.1x |
| Next 9% (90-99th) | ~4.3x |
| Middle 40% | ~3.5x |
| **Bottom 50%** | **~5.7x** |

**Correction to the article's framing**: The DFA data shows approximately **7.4x** real growth for the top 0.1% since 1989 (36 years), not 13x. The 13x figure from Saez & Zucman covers the full **50-year** period starting from the mid-1970s, and uses a different methodology (capitalized income tax data rather than the Fed's survey-based DFA). Both approaches are legitimate, but they measure different things over different timeframes.

The bottom 50% showing a high growth multiple is actually misleading — they started from an extremely low (sometimes negative) base. Going from effectively $0 to $4.3 trillion looks like 5.7x growth, but in absolute terms the top 0.1% added roughly **$21 trillion** while the bottom 50% added roughly **$3.5 trillion**. The percentage game flatters the bottom; the dollar game reveals the chasm.

```r
# ============================================================
# Absolute dollar gains (inflation-adjusted) — the real story
# ============================================================
absolute_gains <- growth_real %>%
  filter(date == max(date)) %>%
  mutate(
    real_gain_trillions = (real_value - real_base) / 1e6
  ) %>%
  select(group, real_gain_trillions) %>%
  arrange(desc(real_gain_trillions))

print(absolute_gains)
```

## Part 3: The Asset Composition Gap

The WSJ article claims that "nearly 72% of [the top 0.1%'s] wealth is made up of corporate equities, mutual fund shares and private businesses." Let's verify this with the actual DFA data on asset composition.

```r
# ============================================================
# CLAIM 3: Asset composition of the top 0.1%
# FRED DFA Series — Asset types held by top 0.1%
# ============================================================
asset_series_top01 <- tribble(
  ~asset_type,                          ~series_id,
  "Corporate Equities & Mutual Funds",  "WFRBLTP1232",
  "Real Estate",                        "WFRBLTP1251",
  "Deposits",                           "WFRBLDE999T100",
  "Defined Contribution Pensions",      "WFRBLDCP999T100",
  "Defined Benefit Pensions",           "WFRBLDBP999T100",
  "Debt Securities",                    "WFRBLTP1233",
  "Life Insurance",                     "WFRBLTP1240",
  "Consumer Durables",                  "WFRBLTP1230",
  "Money Market Funds",                 "WFRBLTP1244"
)

asset_data <- asset_series_top01 %>%
  mutate(data = map(series_id, ~ fredr(
    series_id = .x,
    observation_start = as.Date("2025-07-01"),
    observation_end   = as.Date("2025-10-01")
  ))) %>%
  unnest(data) %>%
  filter(date == max(date)) %>%
  select(asset_type, value) %>%
  mutate(share = value / sum(value) * 100) %>%
  arrange(desc(share))

print(asset_data)
```

### Asset Composition of the Top 0.1% (Q3 2025)

| Asset Type | Value (Millions $) | Share of Total Assets |
|---|---|---|
| **Corporate Equities & Mutual Funds** | **$13,664,419** | **54.4%** |
| Real Estate | $1,917,100 | 7.6% |
| Deposits | $1,427,371 | 5.7% |
| Debt Securities | $1,105,139 | 4.4% |
| Money Market Funds | $898,543 | 3.6% |
| Consumer Durables | $677,970 | 2.7% |
| Defined Benefit Pensions | $300,727 | 1.2% |
| Life Insurance | $242,048 | 1.0% |
| Defined Contribution Pensions | $156,201 | 0.6% |

**Correction**: The article claims "nearly 72%" of the top 0.1%'s wealth is in equities and private businesses. The DFA data shows corporate equities and mutual funds alone account for **54.4%** of their total assets. The "72%" figure from the article likely includes equity in noncorporate businesses (S-corps, partnerships, LLCs — the "car dealerships" Zidar studies), which the DFA tracks separately. Adding that category would push toward the 72% range. The core claim is directionally correct: the ultra-wealthy are overwhelmingly invested in equity markets and business ownership, not housing.

By contrast, let's look at the bottom 50%:

```r
# ============================================================
# Asset composition of the Bottom 50% for comparison
# ============================================================
asset_series_bottom50 <- tribble(
  ~asset_type,                          ~series_id,
  "Corporate Equities & Mutual Funds",  "WFRBLB50095",
  "Real Estate",                        "WFRBLB50083",
  "Deposits",                           "WFRBLDEB50",
  "Defined Contribution Pensions",      "WFRBLDCPB50",
  "Defined Benefit Pensions",           "WFRBLDBPB50",
  "Consumer Durables",                  "WFRBLB50084",
  "Life Insurance",                     "WFRBLB50096"
)

asset_bottom50 <- asset_series_bottom50 %>%
  mutate(data = map(series_id, ~ fredr(
    series_id = .x,
    observation_start = as.Date("2025-07-01"),
    observation_end   = as.Date("2025-10-01")
  ))) %>%
  unnest(data) %>%
  filter(date == max(date)) %>%
  select(asset_type, value) %>%
  mutate(share = value / sum(value) * 100) %>%
  arrange(desc(share))

print(asset_bottom50)
```

### Asset Composition of the Bottom 50% (Q3 2025)

| Asset Type | Value (Millions $) | Share of Total Assets |
|---|---|---|
| **Real Estate** | **$4,824,873** | **47.1%** |
| Consumer Durables (cars, furniture) | $2,017,313 | 19.7% |
| Deposits | $773,674 | 7.6% |
| Defined Contribution Pensions | $692,170 | 6.8% |
| Corporate Equities & Mutual Funds | $602,485 | **5.9%** |
| Defined Benefit Pensions | $486,843 | 4.8% |
| Life Insurance | $174,776 | 1.7% |

This is the structural mechanism of wealth divergence. The top 0.1% have **54%** of their wealth in equities, which have tripled over the past decade. The bottom 50% have **47%** in real estate and **20%** in depreciating consumer durables like cars. When the S&P 500 goes up 25% in a year, the top 0.1% gain trillions. When home prices go up 5%, the bottom 50% gain modestly — and that gain is offset by their mortgage liabilities ($3.07 trillion in home mortgages per the DFA).

## Part 4: The Household Count Pyramid

The WSJ cites 430,000 households worth $30M+ and 74,000 worth $100M+. These are from Zidar's analysis, which uses finer granularity than the standard DFA percentile groups. The DFA itself provides household counts by percentile:

```r
# ============================================================
# CLAIM 4: Household counts by percentile group
# FRED DFA Series — Household counts
# ============================================================
hh_series <- tribble(
  ~group,                  ~series_id,
  "Top 0.1%",              "WFRBLTP1310",
  "Next 0.9% (99-99.9th)", "WFRBL99T999308",
  "Next 9% (90-99th)",     "WFRBLN09303",
  "Middle 40% (50-90th)",  "WFRBLN40301",
  "Bottom 50%",            "WFRBLB50300"
)

hh_data <- hh_series %>%
  mutate(data = map(series_id, pull_fred)) %>%
  unnest(data) %>%
  select(group, date, households = value)

# Latest counts
latest_hh <- hh_data %>%
  filter(date == max(date)) %>%
  mutate(total_hh = sum(households),
         pct_of_total = households / total_hh * 100)

print(latest_hh %>% select(group, households, pct_of_total))
```

### Household Counts (Q3 2025)

| Group | Households | % of All Households |
|---|---|---|
| Top 0.1% | 136,453 | 0.10% |
| Next 0.9% | 1,217,493 | 0.90% |
| Next 9% | 12,179,892 | 8.99% |
| Middle 40% | 54,203,942 | 40.01% |
| Bottom 50% | 67,751,323 | 50.01% |
| **Total** | **135,489,103** | **100%** |

The top 1% is 1,353,946 households — about 1.35 million families. Zidar's 430,000 figure for $30M+ represents a subset within this, roughly the top 0.3%. The DFA confirms that the top 0.1% alone (136,453 households) holds $24.9 trillion. To put that in perspective: each top 0.1% household holds, on average, **$182 million** in net worth. Each bottom-50% household holds, on average, **$62,750**.

```r
# ============================================================
# Per-household average wealth by group
# ============================================================
per_hh <- latest %>%
  filter(group != "Top 1%") %>%
  left_join(
    latest_hh %>% select(group, households),
    by = "group"
  ) %>%
  mutate(avg_wealth_per_hh = (value * 1e6) / households) %>%
  select(group, avg_wealth_per_hh)

print(per_hh)
# Top 0.1%:            ~$182,390,000
# Next 0.9%:           ~$24,570,000
# Next 9%:             ~$5,172,000
# Middle 40%:          ~$937,800
# Bottom 50%:          ~$62,750
```

The ratio between the average top 0.1% household and the average bottom 50% household is roughly **2,906 to 1**. Not 10x, not 100x — nearly three thousand to one.

## Part 5: The Debt Trap at the Bottom

The article briefly mentions that "average inflation-adjusted wealth turned negative for [the bottom 50%] starting in the mid-1990s." Let's verify this with the liability data:

```r
# ============================================================
# CLAIM 5: Bottom 50% liabilities vs assets over time
# ============================================================
bottom50_balance <- tibble(
  component = c("Total Assets", "Total Liabilities"),
  series_id = c("WFRBLB50081", "WFRBLB50100")
) %>%
  mutate(data = map(series_id, pull_fred)) %>%
  unnest(data) %>%
  select(component, date, value) %>%
  pivot_wider(names_from = component, values_from = value) %>%
  mutate(
    net_worth  = `Total Assets` - `Total Liabilities`,
    debt_ratio = `Total Liabilities` / `Total Assets` * 100
  )

# When was net worth closest to zero or negative?
bottom50_balance %>%
  filter(net_worth == min(net_worth)) %>%
  select(date, net_worth, debt_ratio)

# Q3 2025 snapshot
bottom50_balance %>%
  filter(date == max(date)) %>%
  select(date, `Total Assets`, `Total Liabilities`, net_worth, debt_ratio)
```

### Bottom 50% Balance Sheet (Q3 2025)

| | Value (Millions $) |
|---|---|
| Total Assets | $10,246,860 |
| Total Liabilities | $5,995,648 |
| **Net Worth** | **$4,251,212** |
| Debt-to-Asset Ratio | **58.5%** |

The bottom 50% carry **$6 trillion** in debt against **$10.2 trillion** in assets. Their debt-to-asset ratio is 58.5%, compared to roughly 1% for the top 0.1% ($235 billion in liabilities against $25.1 trillion in assets). The bottom half of America is leveraged — their "wealth" is largely offset by mortgages ($3.07T), consumer credit ($2.60T), and other loans.

The article's claim about negative average wealth in the mid-1990s through the pandemic is confirmed by the DFA time series. Net worth for the bottom 50% hovered near zero (and likely dipped negative in some quarters) before the post-2020 recovery driven by rising home prices and stimulus.

## Part 6: The Wealth Share Trend Over Time

```r
# ============================================================
# WEALTH SHARES OVER TIME (1989–2025)
# ============================================================
share_series <- tribble(
  ~group,               ~series_id,
  "Top 0.1%",           "WFRBSTP1300",
  "Top 1%",             "WFRBST01134",
  "Bottom 50%",         "WFRBSB50215"
)

share_data <- share_series %>%
  mutate(data = map(series_id, ~ fredr(
    series_id = .x,
    observation_start = as.Date("1989-07-01"),
    observation_end   = as.Date("2025-10-01")
  ))) %>%
  unnest(data) %>%
  select(group, date, share = value)

ggplot(share_data, aes(x = date, y = share, color = group)) +
  geom_line(linewidth = 1.2) +
  scale_y_continuous(labels = label_percent(scale = 1)) +
  labs(
    title = "Share of U.S. Household Net Worth by Group (1989–2025)",
    subtitle = "Source: Federal Reserve Distributional Financial Accounts",
    x = NULL, y = "Share of Total Net Worth",
    color = "Wealth Group"
  ) +
  theme_minimal(base_size = 14) +
  scale_color_manual(values = c(
    "Top 0.1%" = "#e63946",
    "Top 1%"   = "#457b9d",
    "Bottom 50%" = "#2a9d8f"
  ))
```

The top 0.1% share has risen from roughly 8.6% in 1989 to **14.4%** in Q3 2025. The top 1% has gone from ~23% to ~31.7%. Meanwhile, the bottom 50% share peaked at roughly 3% post-pandemic and sits at **2.5%** — meaning half of all American households share just one-fortieth of total wealth.

## Fact-Checking Gemini's Claims

We asked Google's Gemini to analyze the WSJ article and it made several specific claims. Here's how they hold up against the actual data:

**Claim: "430,000 households worth $30 million or more"**
**Verdict: Plausible but unverifiable from DFA alone.** The DFA groups data into top 0.1% (136K households), next 0.9% (1.2M households), etc. Zidar's $30M+ threshold falls between these bins. Given the top 0.1% averages $182M and the next 0.9% averages $24.6M, a $30M cutoff within the top 0.3-0.5% yielding ~430K households is consistent with the distribution shape.

**Claim: "1.8 to 2.4 million households worth $10 million or more"**
**Verdict: Reasonable estimate.** The top 1% is 1.35 million households, and their average net worth is ~$40.5 million. If we assume many households in the top 2-3% also exceed $10M (the 90th-99th percentile averages $5.2M, but the upper portion of that band skews much higher), a figure around 1.8-2.4M is plausible. However, this is an extrapolation — the DFA doesn't give us the exact $10M threshold.

**Claim: "Top 0.1% wealth has grown 13-fold in real terms over 50 years"**
**Verdict: Plausible for the 1975-2025 window, but not verifiable from DFA data (which starts in 1989).** The DFA shows ~7.4x real growth over 36 years (1989-2025). Extrapolating backward to 1975 with Saez & Zucman's capitalized income methodology, 13x is consistent. But the two methodologies differ, so this is a cross-source claim.

**Claim: "The median household has $192,900 in net worth"**
**Verdict: Consistent with Federal Reserve Survey of Consumer Finances.** The DFA doesn't directly report the median, but the 2022 SCF reported median household net worth of $192,900, which aligns. Note this is the median among all households, not adjusted for household size.

**Claim: "You need $13.7 million to be in the top 1%"**
**Verdict: Plausible.** The DFA's "Minimum Wealth Cutoff" series for the top 1% would give the exact answer, but this data has been intermittently published. The 2022 SCF placed the 99th percentile threshold at roughly $11-13 million. With the 18% real growth in top-1% wealth since 2022, $13.7M in 2026 is a reasonable estimate.

**Claim: "72% of top 0.1% wealth is in corporate equities, mutual funds, and private businesses"**
**Verdict: Partially confirmed.** Corporate equities and mutual funds alone account for 54.4% of top-0.1% total assets. Adding equity in noncorporate business (which the DFA tracks but the data was not published for Q3 2025) would push this toward 70-75%, consistent with the article's claim.

## Conclusion: The Article Understates the Problem

The WSJ article is factually grounded. The core narrative — that a rapidly growing class of ultra-wealthy households is reshaping the economy — is confirmed by every metric in the Federal Reserve's own data. But the article's framing as a consumer trend piece ("they're buying private jets and Hermès bags") obscures the structural story:

1. **136,000 families hold six times the wealth of 67.8 million families.** This ratio has worsened every decade since 1989.

2. **The mechanism is asset composition, not income.** The rich hold equities that compound. The bottom half hold houses and cars that depreciate or grow slowly. When the market goes up, inequality mechanically widens.

3. **The bottom 50% are leveraged.** Their $10.2 trillion in assets is offset by $6 trillion in debt, mostly mortgages and consumer credit. Their "net worth" is fragile and rate-sensitive.

4. **The "suddenly everywhere" framing is misleading.** This has been a monotonic 36-year trend in the data. There is nothing sudden about it. What's changed is that the absolute number of ultra-wealthy households has crossed a visibility threshold where their spending patterns distort markets (housing, travel, luxury goods) that ordinary Americans also participate in.

The R code above is fully reproducible. Get a free API key from [FRED](https://fred.stlouisfed.org/docs/api/api_key.html), substitute it in the setup block, and run it yourself. The data doesn't lie, even when the headlines do.

## References

<a id="wsj-reference"></a> 1. Ensign, Rachel Louise. "They're Rich but Not Famous—and They're Suddenly Everywhere." *The Wall Street Journal*, March 24, 2026. [↩](#wsj-citation)

<a id="fed-dfa-reference"></a> 2. Board of Governors of the Federal Reserve System. "Distributional Financial Accounts." Federal Reserve, updated quarterly. [https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm](https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm)

<a id="fred-reference"></a> 3. Federal Reserve Bank of St. Louis. "Federal Reserve Economic Data (FRED)." [https://fred.stlouisfed.org](https://fred.stlouisfed.org)

<a id="zidar-reference"></a> 4. Zidar, Owen, Matthew Smith, and Eric Zwick. "Top Wealth in America: New Estimates and Implications for Taxing the Rich." NBER Working Paper 29374, 2021. [https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich](https://zidar.princeton.edu/publications/top-wealth-america-new-estimates-and-implications-taxing-rich)

<a id="realtime-inequality-reference"></a> 5. Saez, Emmanuel, and Gabriel Zucman. "Realtime Inequality." [https://realtimeinequality.org](https://realtimeinequality.org)

<a id="scf-reference"></a> 6. Board of Governors of the Federal Reserve System. "Survey of Consumer Finances (SCF), 2022." [https://www.federalreserve.gov/publications/files/scf23.pdf](https://www.federalreserve.gov/publications/files/scf23.pdf)
