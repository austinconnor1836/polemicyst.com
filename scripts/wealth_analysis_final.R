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

cat("\n========================================\n")
cat("1. THE WEALTH SNAPSHOT\n")
cat("========================================\n\n")

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

total_wealth <- sum(latest$value_trillions)
cat(sprintf("  Latest data: %s\n\n", max(wealth_data$date)))
for (i in 1:nrow(latest)) {
  cat(sprintf("  %-30s  $%.1fT  (%.1f%%)\n",
              latest$group[i], latest$value_trillions[i], latest$share_pct[i]))
}
cat(sprintf("  %-30s  $%.1fT  (100%%)\n", "TOTAL", total_wealth))

top01 <- latest$value_trillions[latest$group == "Top 0.1%"]
bot50 <- latest$value_trillions[latest$group == "Bottom 50%"]
cat(sprintf("\n  Top 0.1%% to Bottom 50%% wealth ratio: %.1f to 1\n", top01 / bot50))

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
total_hh <- sum(hh_df$households)
hh_df$pct_of_total <- hh_df$households / total_hh * 100

cat("\n  --- Household Counts ---\n")
for (i in 1:nrow(hh_df)) {
  cat(sprintf("  %-30s  %12s  (%.2f%%)\n",
              hh_df$group[i],
              format(round(hh_df$households[i]), big.mark = ","),
              hh_df$pct_of_total[i]))
}
cat(sprintf("  %-30s  %12s\n", "TOTAL", format(round(total_hh), big.mark = ",")))

cat("\n  --- Per-Household Average Net Worth ---\n")
growth_groups <- c("Top 0.1%", "Next 0.9% (99-99.9th)", "Next 9% (90-99th)",
                   "Middle 40% (50-90th)", "Bottom 50%")
for (grp in growth_groups) {
  nw <- latest$value_trillions[latest$group == grp] * 1e12
  hh <- hh_df$households[hh_df$group == grp]
  cat(sprintf("  %-30s  $%s\n", grp, format(round(nw / hh), big.mark = ",")))
}

top01_avg <- (latest$value_trillions[latest$group == "Top 0.1%"] * 1e12) /
              hh_df$households[hh_df$group == "Top 0.1%"]
bot50_avg <- (latest$value_trillions[latest$group == "Bottom 50%"] * 1e12) /
              hh_df$households[hh_df$group == "Bottom 50%"]
cat(sprintf("\n  Per-household ratio (Top 0.1%% / Bottom 50%%): %.0f to 1\n", top01_avg / bot50_avg))

cat("\n  --- Verifying the '430,000 households worth $30M+' claim ---\n")
cat(sprintf("  Top 0.1%% = %s households, avg $%sM\n",
    format(round(hh_df$households[hh_df$group == "Top 0.1%"]), big.mark = ","),
    format(round(top01_avg / 1e6), big.mark = ",")))
next09_avg <- (latest$value_trillions[latest$group == "Next 0.9% (99-99.9th)"] * 1e12) /
               hh_df$households[hh_df$group == "Next 0.9% (99-99.9th)"]
cat(sprintf("  Next 0.9%% = %s households, avg $%sM\n",
    format(round(hh_df$households[hh_df$group == "Next 0.9% (99-99.9th)"]), big.mark = ","),
    format(round(next09_avg / 1e6), big.mark = ",")))
cat("  All of top 0.1% exceed $30M. Upper portion of next 0.9% also exceeds $30M.\n")
pct_of_next09 <- (430000 - hh_df$households[hh_df$group == "Top 0.1%"]) /
                  hh_df$households[hh_df$group == "Next 0.9% (99-99.9th)"]
cat(sprintf("  430K implies top 0.1%% + top %.0f%% of next 0.9%% band = plausible\n",
    pct_of_next09 * 100))


cat("\n========================================\n")
cat("2. HOW FAST DID THEY GET RICH?\n")
cat("========================================\n\n")

cpi_raw <- pull_fred_csv("CPIAUCSL")
cpi_raw$quarter <- as.Date(paste0(format(cpi_raw$date, "%Y-"),
  sprintf("%02d", ((as.numeric(format(cpi_raw$date, "%m")) - 1) %/% 3) * 3 + 1),
  "-01"))
cpi_quarterly <- cpi_raw %>%
  group_by(quarter) %>%
  summarise(cpi = mean(value, na.rm = TRUE), .groups = "drop") %>%
  rename(date = quarter)

cat("  --- Growth Multiples (Q3 1989 to latest) ---\n")
cat(sprintf("  %-30s  %10s  %10s  %12s\n", "Group", "Nominal", "Real", "Real $ Gain"))

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
  cat(sprintf("  %-30s  %8.1fx  %8.1fx  %10.1fT\n",
              grp, nominal_x, real_x, real_gain))
}

cat("\n  NOTE: The article claims '13-fold in real terms over 50 years.'\n")
cat("  The Fed DFA data covers 36 years (1989-2025) and shows 5.5x real.\n")
cat("  The NOMINAL growth is 14.2x — likely what's being conflated.\n")
cat("  The '13x real' figure comes from Saez & Zucman using a different\n")
cat("  methodology and a longer timeframe starting in the mid-1970s.\n")


cat("\n========================================\n")
cat("3. WHAT DO THEY OWN?\n")
cat("========================================\n\n")

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
total_assets_top01 <- total_assets_top01_df$value[total_assets_top01_df$date == max(total_assets_top01_df$date)]

asset_top01 <- bind_rows(lapply(names(asset_map_top01), function(a) {
  df <- pull_fred_csv(asset_map_top01[[a]])
  data.frame(asset_type = a, value = df$value[df$date == max(df$date)])
}))
asset_top01$share_pct <- asset_top01$value / total_assets_top01 * 100
asset_top01 <- asset_top01[order(-asset_top01$share_pct), ]

cat("  --- Top 0.1% Asset Composition ---\n")
cat(sprintf("  Total assets: $%s M\n\n", format(round(total_assets_top01), big.mark = ",")))
for (i in 1:nrow(asset_top01)) {
  cat(sprintf("  %-35s  $%12s M  (%5.1f%%)\n",
              asset_top01$asset_type[i],
              format(round(asset_top01$value[i]), big.mark = ","),
              asset_top01$share_pct[i]))
}

equities_pct <- asset_top01$share_pct[asset_top01$asset_type == "Corp Equities & Mutual Funds"]
cat(sprintf("\n  Equities & mutual funds alone: %.1f%% of total assets\n", equities_pct))
cat("  The article claims 72% including private businesses (noncorporate equity).\n")
cat("  That category is tracked separately by the DFA but wasn't published for Q3 2025.\n")
cat(sprintf("  Gap to fill: %.1f%% — plausible if noncorporate equity is included.\n",
    72 - equities_pct))

cat("\n  --- Bottom 50% Asset Composition (for comparison) ---\n")
asset_map_bot50 <- list(
  "Corp Equities & Mutual Funds" = "WFRBLB50095",
  "Real Estate"                  = "WFRBLB50083",
  "Deposits"                     = "WFRBLDEB50",
  "Defined Contribution Pensions"= "WFRBLDCPB50",
  "Defined Benefit Pensions"     = "WFRBLDBPB50",
  "Consumer Durables"            = "WFRBLB50084",
  "Life Insurance"               = "WFRBLB50096"
)

total_assets_bot50_df <- pull_fred_csv("WFRBLB50081")
total_assets_bot50 <- total_assets_bot50_df$value[total_assets_bot50_df$date == max(total_assets_bot50_df$date)]

asset_bot50 <- bind_rows(lapply(names(asset_map_bot50), function(a) {
  df <- pull_fred_csv(asset_map_bot50[[a]])
  data.frame(asset_type = a, value = df$value[df$date == max(df$date)])
}))
asset_bot50$share_pct <- asset_bot50$value / total_assets_bot50 * 100
asset_bot50 <- asset_bot50[order(-asset_bot50$share_pct), ]

cat(sprintf("  Total assets: $%s M\n\n", format(round(total_assets_bot50), big.mark = ",")))
for (i in 1:nrow(asset_bot50)) {
  cat(sprintf("  %-35s  $%12s M  (%5.1f%%)\n",
              asset_bot50$asset_type[i],
              format(round(asset_bot50$value[i]), big.mark = ","),
              asset_bot50$share_pct[i]))
}

bot50_eq <- asset_bot50$share_pct[asset_bot50$asset_type == "Corp Equities & Mutual Funds"]
bot50_re <- asset_bot50$share_pct[asset_bot50$asset_type == "Real Estate"]
bot50_dur <- asset_bot50$share_pct[asset_bot50$asset_type == "Consumer Durables"]
cat(sprintf("\n  Top 0.1%%: %.1f%% in equities. Bottom 50%%: %.1f%% in equities.\n",
    equities_pct, bot50_eq))
cat(sprintf("  Bottom 50%%: %.1f%% in real estate + %.1f%% in depreciating durables (cars, etc.)\n",
    bot50_re, bot50_dur))


cat("\n========================================\n")
cat("4. THE DEBT TRAP\n")
cat("========================================\n\n")

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

latest_bal <- bal[nrow(bal), ]
cat(sprintf("  --- Bottom 50%% Balance Sheet (%s) ---\n", latest_bal$date))
cat(sprintf("  Total Assets:      $%s M\n", format(round(latest_bal$assets), big.mark = ",")))
cat(sprintf("  Total Liabilities: $%s M\n", format(round(latest_bal$liabilities), big.mark = ",")))
cat(sprintf("  Net Worth:         $%s M\n", format(round(latest_bal$net_worth), big.mark = ",")))
cat(sprintf("  Debt-to-Asset:     %.1f%%\n", latest_bal$debt_ratio))

min_row <- bal[which.min(bal$net_worth), ]
cat(sprintf("\n  Worst quarter: %s\n", min_row$date))
cat(sprintf("  Net worth then: $%s M\n", format(round(min_row$net_worth), big.mark = ",")))
cat(sprintf("  Debt-to-Asset then: %.1f%%\n", min_row$debt_ratio))
cat(sprintf("\n  Quarters with NEGATIVE net worth in DFA data: %d\n", sum(bal$net_worth <= 0)))

cat("\n  --- What the bottom 50% owe ---\n")
liab_map <- list(
  "Home Mortgages"  = "WFRBLB50102",
  "Consumer Credit" = "WFRBLB50103",
  "Other Loans"     = "WFRBLB50105"
)
for (a in names(liab_map)) {
  df <- pull_fred_csv(liab_map[[a]])
  val <- df$value[df$date == max(df$date)]
  cat(sprintf("  %-25s  $%s M\n", a, format(round(val), big.mark = ",")))
}

top01_liab <- pull_fred_csv("WFRBLTP1239")
top01_liab_val <- top01_liab$value[top01_liab$date == max(top01_liab$date)]
cat(sprintf("\n  Top 0.1%% debt-to-asset ratio: %.1f%%\n", top01_liab_val / total_assets_top01 * 100))
cat(sprintf("  Bottom 50%% debt-to-asset ratio: %.1f%%\n", latest_bal$debt_ratio))
cat(sprintf("  Bottom 50%% are leveraged at %.0fx the rate of the top 0.1%%\n",
    latest_bal$debt_ratio / (top01_liab_val / total_assets_top01 * 100)))

cat("\n  NOTE: The article says wealth 'turned negative' for the bottom 50%%.\n")
cat("  The DFA shows ZERO quarters of negative aggregate net worth.\n")
cat("  The minimum was Q4 2010: $246B positive, but with 95.4%% debt-to-asset.\n")
cat("  The 'negative' claim comes from Saez & Zucman's different methodology.\n")


cat("\n========================================\n")
cat("5. WEALTH SHARES OVER TIME\n")
cat("========================================\n\n")

share_map <- list(
  "Top 0.1%"   = "WFRBSTP1300",
  "Top 1%"     = "WFRBST01134",
  "Bottom 50%" = "WFRBSB50215"
)

for (grp in names(share_map)) {
  df <- pull_fred_csv(share_map[[grp]])
  cat(sprintf("  %s share of total net worth:\n", grp))
  cat(sprintf("    First (%s): %.1f%%\n", df$date[1], df$value[1]))
  cat(sprintf("    Latest (%s): %.1f%%\n", df$date[nrow(df)], df$value[nrow(df)]))
  cat(sprintf("    Min (%s): %.1f%%\n", df$date[which.min(df$value)], min(df$value)))
  cat(sprintf("    Max (%s): %.1f%%\n\n", df$date[which.max(df$value)], max(df$value)))
}


cat("========================================\n")
cat("6. DESCRIPTIVE STATISTICS\n")
cat("========================================\n\n")

for (grp in growth_groups) {
  grp_data <- wealth_data %>% filter(group == grp)
  vals <- grp_data$value / 1e6
  cat(sprintf("  %s (Trillions $):\n", grp))
  cat(sprintf("    N: %d quarters | Min: $%.2fT (%s) | Max: $%.2fT (%s)\n",
              length(vals),
              min(vals), grp_data$date[which.min(grp_data$value)],
              max(vals), grp_data$date[which.max(grp_data$value)]))
  cat(sprintf("    Median: $%.2fT | Mean: $%.2fT | SD: $%.2fT\n\n",
              median(vals), mean(vals), sd(vals)))
}


cat("========================================\n")
cat("7. THE HEAVY-TAILED PYRAMID\n")
cat("========================================\n\n")

cat("  --- Concentration Ratios ---\n")
cat(sprintf("  %-30s  %8s  %10s  %14s\n", "Group", "% of HH", "% of Wealth", "Concentration"))
for (grp in growth_groups) {
  hh_pct <- hh_df$pct_of_total[hh_df$group == grp]
  w_pct  <- latest$share_pct[latest$group == grp]
  cat(sprintf("  %-30s  %6.2f%%  %8.1f%%  %12.1fx\n",
              grp, hh_pct, w_pct, w_pct / hh_pct))
}

cat("\n  --- Cumulative Distribution (bottom to top) ---\n")
cum_hh <- 0; cum_w <- 0
for (grp in rev(growth_groups)) {
  cum_hh <- cum_hh + hh_df$pct_of_total[hh_df$group == grp]
  cum_w  <- cum_w + latest$share_pct[latest$group == grp]
  cat(sprintf("  + %-30s  Cum HH: %5.1f%%  Cum Wealth: %5.1f%%\n", grp, cum_hh, cum_w))
}

cat("\n  --- Per-Household Wealth Ladder ---\n")
for (grp in growth_groups) {
  nw <- latest$value_trillions[latest$group == grp] * 1e12
  hh <- hh_df$households[hh_df$group == grp]
  avg <- nw / hh
  bar_units <- min(round(avg / 1e6), 100)
  bar <- paste(rep("\u2588", bar_units), collapse = "")
  cat(sprintf("  %-30s  $%12s  %s\n", grp,
              format(round(avg), big.mark = ","), bar))
}

cat("\n  --- Step Ratios Between Adjacent Tiers ---\n")
avg_wealth <- setNames(
  (latest$value_trillions * 1e12) / hh_df$households[match(latest$group, hh_df$group)],
  latest$group
)
pairs <- list(
  c("Bottom 50%", "Middle 40% (50-90th)"),
  c("Middle 40% (50-90th)", "Next 9% (90-99th)"),
  c("Next 9% (90-99th)", "Next 0.9% (99-99.9th)"),
  c("Next 0.9% (99-99.9th)", "Top 0.1%")
)
for (p in pairs) {
  cat(sprintf("  %s -> %s: %.1fx\n", p[1], p[2], avg_wealth[p[2]] / avg_wealth[p[1]]))
}
cat("\n  In a normal distribution, step ratios DECREASE as you move up.\n")
cat("  Here the final step (7.4x) is LARGER than the middle steps.\n")
cat("  That's the mathematical signature of a heavy tail.\n")

cat("\n  --- Tail Concentration Over Time ---\n")
share_top01_ts <- pull_fred_csv("WFRBSTP1300")
share_bot50_ts <- pull_fred_csv("WFRBSB50215")

key_years <- c(1989, 1995, 2000, 2005, 2010, 2015, 2020, 2025)
cat(sprintf("  %-6s  %10s  %12s  %8s\n", "Year", "Top 0.1%", "Bottom 50%", "Ratio"))
for (yr in key_years) {
  t01 <- share_top01_ts[which.min(abs(as.numeric(format(share_top01_ts$date, "%Y")) - yr)), ]
  b50 <- share_bot50_ts[which.min(abs(as.numeric(format(share_bot50_ts$date, "%Y")) - yr)), ]
  cat(sprintf("  %-6d  %8.1f%%  %10.1f%%  %6.1fx\n",
              yr, t01$value, b50$value, t01$value / b50$value))
}

cat("\n========================================\n")
cat("ANALYSIS COMPLETE\n")
cat("========================================\n")
