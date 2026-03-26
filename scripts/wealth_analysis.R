#!/usr/bin/env Rscript
# =============================================================================
# Wealth Distribution Analysis
# Pulls Federal Reserve DFA data from FRED CSV endpoints (no API key needed)
# and computes statistics to verify WSJ/Gemini claims
# =============================================================================

library(dplyr)
library(tidyr)
library(purrr)
library(jsonlite)

cat("=== Starting Wealth Distribution Analysis ===\n\n")

# FRED public CSV endpoint — no API key required
pull_fred_csv <- function(series_id) {
  url <- paste0("https://fred.stlouisfed.org/graph/fredgraph.csv?id=", series_id)
  tryCatch({
    df <- read.csv(url, stringsAsFactors = FALSE)
    colnames(df) <- c("date", "value")
    df$date <- as.Date(df$date)
    df$value <- suppressWarnings(as.numeric(df$value))
    df <- df[!is.na(df$value), ]
    df$series_id <- series_id
    df
  }, error = function(e) {
    cat("  ERROR pulling", series_id, ":", conditionMessage(e), "\n")
    NULL
  })
}

# ============================================================
# PART 1: Total Net Worth by Percentile Group
# ============================================================
cat("--- PART 1: Total Net Worth by Percentile Group ---\n")

wealth_map <- list(
  "Top 0.1%"                = "WFRBLTP1246",
  "Next 0.9% (99-99.9th)"   = "WFRBL99T999219",
  "Top 1%"                  = "WFRBLT01026",
  "Next 9% (90-99th)"       = "WFRBLN09053",
  "Middle 40% (50-90th)"    = "WFRBLN40080",
  "Bottom 50%"              = "WFRBLB50107"
)

wealth_data_list <- list()
for (grp in names(wealth_map)) {
  cat("  Pulling", grp, "(", wealth_map[[grp]], ")...\n")
  df <- pull_fred_csv(wealth_map[[grp]])
  if (!is.null(df)) {
    df$group <- grp
    wealth_data_list[[grp]] <- df
  }
}
wealth_data <- bind_rows(wealth_data_list)

# Latest snapshot
latest_date <- max(wealth_data$date)
cat("\n  Latest data date:", as.character(latest_date), "\n\n")

latest <- wealth_data %>%
  filter(date == latest_date) %>%
  select(group, value) %>%
  mutate(value_trillions = value / 1e6)

# Total wealth (excluding "Top 1%" which is a superset)
non_overlapping <- latest %>%
  filter(group %in% c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
                       "Middle 40% (50-90th)", "Bottom 50%"))
total_wealth <- sum(non_overlapping$value_trillions)

latest_shares <- non_overlapping %>%
  mutate(share_pct = value_trillions / total_wealth * 100)

cat("=== Net Worth by Percentile Group (latest quarter) ===\n")
for (i in 1:nrow(latest_shares)) {
  cat(sprintf("  %-30s  $%.1fT  (%.1f%%)\n",
              latest_shares$group[i],
              latest_shares$value_trillions[i],
              latest_shares$share_pct[i]))
}
cat(sprintf("  %-30s  $%.1fT  (100%%)\n", "TOTAL", total_wealth))

# Ratio: Top 0.1% vs Bottom 50%
top01_val <- latest_shares$value_trillions[latest_shares$group == "Top 0.1%"]
bot50_val <- latest_shares$value_trillions[latest_shares$group == "Bottom 50%"]
cat(sprintf("\n  Top 0.1%% to Bottom 50%% ratio: %.1f to 1\n", top01_val / bot50_val))

# ============================================================
# PART 2: Growth Multiples Since 1989 (Nominal & Real)
# ============================================================
cat("\n--- PART 2: Growth Multiples Since 1989 ---\n")

# Pull CPI for inflation adjustment
cat("  Pulling CPI (CPIAUCSL)...\n")
cpi_raw <- pull_fred_csv("CPIAUCSL")
# Average CPI to quarterly
cpi_raw$quarter <- as.Date(paste0(format(cpi_raw$date, "%Y-"),
  sprintf("%02d", ((as.numeric(format(cpi_raw$date, "%m")) - 1) %/% 3) * 3 + 1),
  "-01"))
cpi_quarterly <- cpi_raw %>%
  group_by(quarter) %>%
  summarise(cpi = mean(value, na.rm = TRUE), .groups = "drop") %>%
  rename(date = quarter)

growth_groups <- c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
                   "Middle 40% (50-90th)", "Bottom 50%")

growth_results <- list()
for (grp in growth_groups) {
  grp_data <- wealth_data %>%
    filter(group == grp) %>%
    arrange(date)

  # Nominal growth
  first_val <- grp_data$value[1]
  last_val  <- grp_data$value[nrow(grp_data)]
  nominal_x <- last_val / first_val

  # Real growth (CPI-adjusted)
  merged <- merge(grp_data, cpi_quarterly, by = "date", all.x = TRUE)
  merged <- merged[!is.na(merged$cpi), ]
  merged <- merged[order(merged$date), ]
  if (nrow(merged) > 0) {
    cpi_base <- merged$cpi[1]
    merged$real_value <- merged$value / (merged$cpi / cpi_base)
    real_first <- merged$real_value[1]
    real_last  <- merged$real_value[nrow(merged)]
    real_x <- real_last / real_first
  } else {
    real_x <- NA
  }

  growth_results[[grp]] <- data.frame(
    group = grp,
    first_value_millions = first_val,
    last_value_millions = last_val,
    nominal_growth_x = nominal_x,
    real_growth_x = real_x,
    stringsAsFactors = FALSE
  )
}
growth_df <- bind_rows(growth_results)

cat("\n=== Growth Multiples (Q3 1989 to latest) ===\n")
for (i in 1:nrow(growth_df)) {
  cat(sprintf("  %-30s  Nominal: %.1fx   Real (CPI-adj): %.1fx\n",
              growth_df$group[i],
              growth_df$nominal_growth_x[i],
              growth_df$real_growth_x[i]))
}

# Absolute dollar gains (real)
cat("\n=== Absolute Real Dollar Gains ===\n")
for (grp in growth_groups) {
  grp_data <- wealth_data %>% filter(group == grp) %>% arrange(date)
  merged <- merge(grp_data, cpi_quarterly, by = "date", all.x = TRUE)
  merged <- merged[!is.na(merged$cpi), ]
  merged <- merged[order(merged$date), ]
  if (nrow(merged) > 0) {
    cpi_base <- merged$cpi[1]
    merged$real_value <- merged$value / (merged$cpi / cpi_base)
    real_gain <- (merged$real_value[nrow(merged)] - merged$real_value[1]) / 1e6
    cat(sprintf("  %-30s  Real gain: $%.1fT\n", grp, real_gain))
  }
}

# ============================================================
# PART 3: Asset Composition
# ============================================================
cat("\n--- PART 3: Asset Composition ---\n")

# Top 0.1% assets
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

cat("\n  Pulling Top 0.1% asset data...\n")
# Pull total assets for denominator
total_assets_top01_df <- pull_fred_csv("WFRBLTP1227")
total_assets_top01 <- total_assets_top01_df$value[total_assets_top01_df$date == max(total_assets_top01_df$date)]
cat(sprintf("  Total assets (Top 0.1%%): $%s M\n", format(round(total_assets_top01), big.mark = ",")))

asset_top01_list <- list()
for (a in names(asset_map_top01)) {
  df <- pull_fred_csv(asset_map_top01[[a]])
  if (!is.null(df)) {
    latest_row <- df[df$date == max(df$date), ]
    asset_top01_list[[a]] <- data.frame(
      asset_type = a,
      value = latest_row$value[1],
      stringsAsFactors = FALSE
    )
  }
}
asset_top01 <- bind_rows(asset_top01_list)
asset_top01$share_pct <- asset_top01$value / total_assets_top01 * 100
asset_top01 <- asset_top01[order(-asset_top01$share_pct), ]

cat("\n=== Top 0.1% Asset Composition (latest quarter) ===\n")
for (i in 1:nrow(asset_top01)) {
  cat(sprintf("  %-35s  $%12s M   (%.1f%%)\n",
              asset_top01$asset_type[i],
              format(round(asset_top01$value[i]), big.mark = ","),
              asset_top01$share_pct[i]))
}

# Bottom 50% assets
asset_map_bottom50 <- list(
  "Corp Equities & Mutual Funds" = "WFRBLB50095",
  "Real Estate"                  = "WFRBLB50083",
  "Deposits"                     = "WFRBLDEB50",
  "Defined Contribution Pensions"= "WFRBLDCPB50",
  "Defined Benefit Pensions"     = "WFRBLDBPB50",
  "Consumer Durables"            = "WFRBLB50084",
  "Life Insurance"               = "WFRBLB50096"
)

cat("\n  Pulling Bottom 50% asset data...\n")
total_assets_bot50_df <- pull_fred_csv("WFRBLB50081")
total_assets_bot50 <- total_assets_bot50_df$value[total_assets_bot50_df$date == max(total_assets_bot50_df$date)]
cat(sprintf("  Total assets (Bottom 50%%): $%s M\n", format(round(total_assets_bot50), big.mark = ",")))

asset_bot50_list <- list()
for (a in names(asset_map_bottom50)) {
  df <- pull_fred_csv(asset_map_bottom50[[a]])
  if (!is.null(df)) {
    latest_row <- df[df$date == max(df$date), ]
    asset_bot50_list[[a]] <- data.frame(
      asset_type = a,
      value = latest_row$value[1],
      stringsAsFactors = FALSE
    )
  }
}
asset_bot50 <- bind_rows(asset_bot50_list)
asset_bot50$share_pct <- asset_bot50$value / total_assets_bot50 * 100
asset_bot50 <- asset_bot50[order(-asset_bot50$share_pct), ]

cat("\n=== Bottom 50% Asset Composition (latest quarter) ===\n")
for (i in 1:nrow(asset_bot50)) {
  cat(sprintf("  %-35s  $%12s M   (%.1f%%)\n",
              asset_bot50$asset_type[i],
              format(round(asset_bot50$value[i]), big.mark = ","),
              asset_bot50$share_pct[i]))
}

# ============================================================
# PART 4: Household Counts & Per-Household Averages
# ============================================================
cat("\n--- PART 4: Household Counts ---\n")

hh_map <- list(
  "Top 0.1%"                = "WFRBLTP1310",
  "Next 0.9% (99-99.9th)"   = "WFRBL99T999308",
  "Next 9% (90-99th)"       = "WFRBLN09303",
  "Middle 40% (50-90th)"    = "WFRBLN40301",
  "Bottom 50%"              = "WFRBLB50300"
)

hh_list <- list()
for (grp in names(hh_map)) {
  cat("  Pulling household count for", grp, "...\n")
  df <- pull_fred_csv(hh_map[[grp]])
  if (!is.null(df)) {
    latest_row <- df[df$date == max(df$date), ]
    hh_list[[grp]] <- data.frame(
      group = grp,
      households = latest_row$value[1],
      stringsAsFactors = FALSE
    )
  }
}
hh_df <- bind_rows(hh_list)
total_hh <- sum(hh_df$households)
hh_df$pct_of_total <- hh_df$households / total_hh * 100

cat("\n=== Household Counts (latest quarter) ===\n")
for (i in 1:nrow(hh_df)) {
  cat(sprintf("  %-30s  %12s households  (%.2f%%)\n",
              hh_df$group[i],
              format(round(hh_df$households[i]), big.mark = ","),
              hh_df$pct_of_total[i]))
}
cat(sprintf("  %-30s  %12s households\n", "TOTAL",
            format(round(total_hh), big.mark = ",")))

# Per-household averages
cat("\n=== Per-Household Average Net Worth ===\n")
for (grp in growth_groups) {
  nw <- latest_shares$value_trillions[latest_shares$group == grp] * 1e12
  hh <- hh_df$households[hh_df$group == grp]
  if (length(nw) > 0 && length(hh) > 0 && hh > 0) {
    avg <- nw / hh
    cat(sprintf("  %-30s  $%s\n", grp, format(round(avg), big.mark = ",")))
  }
}

# Ratio
top01_nw <- latest_shares$value_trillions[latest_shares$group == "Top 0.1%"] * 1e12
top01_hh <- hh_df$households[hh_df$group == "Top 0.1%"]
bot50_nw <- latest_shares$value_trillions[latest_shares$group == "Bottom 50%"] * 1e12
bot50_hh <- hh_df$households[hh_df$group == "Bottom 50%"]
if (length(top01_hh) > 0 && length(bot50_hh) > 0) {
  ratio <- (top01_nw / top01_hh) / (bot50_nw / bot50_hh)
  cat(sprintf("\n  Per-household ratio (Top 0.1%% / Bottom 50%%): %.0f to 1\n", ratio))
}

# ============================================================
# PART 5: Bottom 50% Balance Sheet (Debt Trap)
# ============================================================
cat("\n--- PART 5: Bottom 50% Balance Sheet ---\n")

cat("  Pulling total assets & liabilities for Bottom 50%...\n")
bot50_assets <- pull_fred_csv("WFRBLB50081")
bot50_liabilities <- pull_fred_csv("WFRBLB50100")

if (!is.null(bot50_assets) && !is.null(bot50_liabilities)) {
  bal <- merge(
    bot50_assets %>% select(date, assets = value),
    bot50_liabilities %>% select(date, liabilities = value),
    by = "date"
  ) %>%
    mutate(
      net_worth = assets - liabilities,
      debt_ratio = liabilities / assets * 100
    ) %>%
    arrange(date)

  # Latest
  latest_bal <- bal[nrow(bal), ]
  cat(sprintf("\n=== Bottom 50%% Balance Sheet (%s) ===\n", latest_bal$date))
  cat(sprintf("  Total Assets:       $%s M\n", format(round(latest_bal$assets), big.mark = ",")))
  cat(sprintf("  Total Liabilities:  $%s M\n", format(round(latest_bal$liabilities), big.mark = ",")))
  cat(sprintf("  Net Worth:          $%s M\n", format(round(latest_bal$net_worth), big.mark = ",")))
  cat(sprintf("  Debt-to-Asset:      %.1f%%\n", latest_bal$debt_ratio))

  # When was net worth at its minimum?
  min_row <- bal[which.min(bal$net_worth), ]
  cat(sprintf("\n  Minimum net worth date: %s\n", min_row$date))
  cat(sprintf("  Minimum net worth:      $%s M\n", format(round(min_row$net_worth), big.mark = ",")))
  cat(sprintf("  Debt-to-Asset at min:   %.1f%%\n", min_row$debt_ratio))

  # Were there any quarters where net_worth <= 0?
  negative_quarters <- bal %>% filter(net_worth <= 0)
  cat(sprintf("\n  Quarters with negative net worth in DFA data: %d\n", nrow(negative_quarters)))

  # Top 0.1% liabilities for comparison
  cat("  Pulling Top 0.1% liabilities...\n")
  top01_liab <- pull_fred_csv("WFRBLTP1239")
  top01_assets_total <- pull_fred_csv("WFRBLTP1227")
  if (!is.null(top01_liab) && !is.null(top01_assets_total)) {
    t01_l <- top01_liab$value[top01_liab$date == max(top01_liab$date)]
    t01_a <- top01_assets_total$value[top01_assets_total$date == max(top01_assets_total$date)]
    cat(sprintf("\n  Top 0.1%% debt-to-asset ratio: %.1f%%\n", t01_l / t01_a * 100))
  }
}

# ============================================================
# PART 6: Wealth Share Over Time
# ============================================================
cat("\n--- PART 6: Wealth Shares Over Time ---\n")

share_map <- list(
  "Top 0.1%" = "WFRBSTP1300",
  "Top 1%"   = "WFRBST01134",
  "Bottom 50%" = "WFRBSB50215"
)

for (grp in names(share_map)) {
  df <- pull_fred_csv(share_map[[grp]])
  if (!is.null(df)) {
    first_row <- df[1, ]
    last_row <- df[nrow(df), ]
    min_row <- df[which.min(df$value), ]
    max_row <- df[which.max(df$value), ]
    cat(sprintf("\n  %s share of total net worth:\n", grp))
    cat(sprintf("    First (%s): %.1f%%\n", first_row$date, first_row$value))
    cat(sprintf("    Latest (%s): %.1f%%\n", last_row$date, last_row$value))
    cat(sprintf("    Min (%s): %.1f%%\n", min_row$date, min_row$value))
    cat(sprintf("    Max (%s): %.1f%%\n", max_row$date, max_row$value))
  }
}

# ============================================================
# PART 7: Summary Statistics for All Groups
# ============================================================
cat("\n--- PART 7: Descriptive Statistics (Min/Max/Median/Mean) ---\n")

for (grp in growth_groups) {
  grp_data <- wealth_data %>% filter(group == grp)
  if (nrow(grp_data) > 0) {
    vals <- grp_data$value / 1e6  # convert to trillions
    cat(sprintf("\n  %s Net Worth (Trillions $):\n", grp))
    cat(sprintf("    Observations: %d quarters\n", length(vals)))
    cat(sprintf("    Min:    $%.2fT (%s)\n", min(vals), grp_data$date[which.min(grp_data$value)]))
    cat(sprintf("    Max:    $%.2fT (%s)\n", max(vals), grp_data$date[which.max(grp_data$value)]))
    cat(sprintf("    Median: $%.2fT\n", median(vals)))
    cat(sprintf("    Mean:   $%.2fT\n", mean(vals)))
    cat(sprintf("    SD:     $%.2fT\n", sd(vals)))
  }
}

# ============================================================
# PART 8: Home Mortgage Breakdown for Bottom 50%
# ============================================================
cat("\n--- PART 8: Bottom 50% Liability Breakdown ---\n")

liab_map_bot50 <- list(
  "Home Mortgages"       = "WFRBLB50102",
  "Consumer Credit"      = "WFRBLB50103",
  "Other Loans"          = "WFRBLB50105"
)

for (a in names(liab_map_bot50)) {
  df <- pull_fred_csv(liab_map_bot50[[a]])
  if (!is.null(df)) {
    latest_row <- df[df$date == max(df$date), ]
    cat(sprintf("  %-25s  $%s M\n", a,
                format(round(latest_row$value[1]), big.mark = ",")))
  }
}

# ============================================================
# PART 9: Heavy-Tailed Pyramid Distribution Analysis
# ============================================================
cat("\n--- PART 9: Heavy-Tailed Pyramid Distribution ---\n")

# The "pyramid" claim: wealth follows a power-law-like distribution
# where a tiny fraction at the top holds a disproportionate share.
# We quantify this by computing the Gini-like concentration ratios.

cat("\n=== Wealth Pyramid: Households vs. Wealth Share ===\n")
cat(sprintf("  %-30s  %10s  %12s  %12s  %14s\n",
            "Group", "Households", "% of HH", "% of Wealth", "Ratio (W/HH)"))
cat(sprintf("  %-30s  %10s  %12s  %12s  %14s\n",
            "-----", "----------", "-------", "-----------", "------------"))

pyramid_groups <- c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
                    "Middle 40% (50-90th)", "Bottom 50%")

for (grp in pyramid_groups) {
  hh_pct <- hh_df$pct_of_total[hh_df$group == grp]
  w_pct  <- latest_shares$share_pct[latest_shares$group == grp]
  ratio  <- w_pct / hh_pct
  hh_count <- hh_df$households[hh_df$group == grp]
  cat(sprintf("  %-30s  %10s  %10.2f%%  %10.1f%%  %12.1fx\n",
              grp,
              format(round(hh_count), big.mark = ","),
              hh_pct, w_pct, ratio))
}

# Cumulative distribution (Lorenz-like) from bottom to top
cat("\n=== Cumulative Distribution (Bottom → Top) ===\n")
cat("  (How wealth accumulates as you move up the distribution)\n\n")
cat(sprintf("  %-45s  %12s  %12s\n", "Cumulative Group", "Cum. HH %", "Cum. Wealth %"))
cat(sprintf("  %-45s  %12s  %12s\n", "----------------", "---------", "-------------"))

# Build cumulative from bottom to top
cum_groups <- rev(pyramid_groups)
cum_hh <- 0
cum_w  <- 0
for (grp in cum_groups) {
  hh_pct <- hh_df$pct_of_total[hh_df$group == grp]
  w_pct  <- latest_shares$share_pct[latest_shares$group == grp]
  cum_hh <- cum_hh + hh_pct
  cum_w  <- cum_w + w_pct
  cat(sprintf("  + %-43s  %10.1f%%  %10.1f%%\n", grp, cum_hh, cum_w))
}

# Per-household wealth distribution showing the exponential ramp
cat("\n=== Per-Household Wealth Ladder ===\n")
cat("  (Shows the exponential shape of the distribution)\n\n")

for (grp in pyramid_groups) {
  nw <- latest_shares$value_trillions[latest_shares$group == grp] * 1e12
  hh <- hh_df$households[hh_df$group == grp]
  if (length(nw) > 0 && length(hh) > 0 && hh > 0) {
    avg <- nw / hh
    # Scale bar visualization (each █ = ~$1M)
    bar_units <- min(round(avg / 1e6), 100)
    bar <- paste(rep("\u2588", bar_units), collapse = "")
    cat(sprintf("  %-30s  $%12s  %s\n", grp,
                format(round(avg), big.mark = ","), bar))
  }
}

# How the distribution has changed over time: wealth share trends
cat("\n=== Tail Concentration Over Time ===\n")
cat("  (Top 0.1% share at key dates)\n\n")

share_top01 <- pull_fred_csv("WFRBSTP1300")
share_bot50 <- pull_fred_csv("WFRBSB50215")

key_dates <- c("1989-07-01", "1995-01-01", "2000-01-01", "2005-01-01",
               "2010-01-01", "2015-01-01", "2020-01-01", "2025-07-01")

cat(sprintf("  %-12s  %12s  %12s  %12s\n",
            "Date", "Top 0.1%", "Bottom 50%", "Ratio"))
cat(sprintf("  %-12s  %12s  %12s  %12s\n",
            "----", "--------", "----------", "-----"))

for (d in key_dates) {
  d_date <- as.Date(d)
  # Find closest date in data
  t01_row <- share_top01[which.min(abs(share_top01$date - d_date)), ]
  b50_row <- share_bot50[which.min(abs(share_bot50$date - d_date)), ]
  ratio <- t01_row$value / b50_row$value
  cat(sprintf("  %-12s  %10.1f%%  %10.1f%%  %10.1fx\n",
              format(t01_row$date, "%Y Q%q"),
              t01_row$value, b50_row$value, ratio))
}

# Inter-group wealth step ratios
cat("\n=== Step Ratios Between Adjacent Groups ===\n")
cat("  (How much richer each tier is than the one below it)\n\n")

avg_wealth <- list()
for (grp in pyramid_groups) {
  nw <- latest_shares$value_trillions[latest_shares$group == grp] * 1e12
  hh <- hh_df$households[hh_df$group == grp]
  avg_wealth[[grp]] <- nw / hh
}

step_pairs <- list(
  c("Bottom 50%", "Middle 40% (50-90th)"),
  c("Middle 40% (50-90th)", "Next 9% (90-99th)"),
  c("Next 9% (90-99th)", "Next 0.9% (99-99.9th)"),
  c("Next 0.9% (99-99.9th)", "Top 0.1%")
)

for (pair in step_pairs) {
  lower <- pair[1]
  upper <- pair[2]
  ratio <- avg_wealth[[upper]] / avg_wealth[[lower]]
  cat(sprintf("  %s → %s: %.1fx step up\n", lower, upper, ratio))
}

# Pareto tail index estimation
cat("\n=== Pareto Tail Index Estimation ===\n")
# For a Pareto distribution: P(X > x) ~ x^(-alpha)
# Using the relationship between mean and threshold at each tier
# alpha = 1 / (1 - threshold/mean) for the tail
# We approximate using top 1% and top 0.1%

top1_avg  <- avg_wealth[["Top 0.1%"]]  # average in top 0.1%
top1_share <- latest_shares$share_pct[latest_shares$group == "Top 0.1%"] / 100
top10_share <- (latest_shares$share_pct[latest_shares$group == "Top 0.1%"] +
                latest_shares$share_pct[latest_shares$group == "Next 0.9% (99-99.9th)"]) / 100

# Pareto alpha from share ratios: alpha ≈ 1 / log(share_ratio) * log(pop_ratio)
# Using top 0.1% vs top 1%:
alpha_est <- log(10) / log(top10_share / top1_share)
cat(sprintf("  Estimated Pareto alpha (tail index): %.2f\n", alpha_est))
cat(sprintf("  (alpha < 2 indicates infinite variance — an extremely heavy tail)\n"))
cat(sprintf("  (alpha ≈ 1.5 is typical for U.S. wealth; lower = heavier tail)\n"))

cat("\n=== ANALYSIS COMPLETE ===\n")
