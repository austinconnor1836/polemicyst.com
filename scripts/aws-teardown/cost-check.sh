#!/usr/bin/env bash
# Post-teardown cost check. Runs after 24-48h have elapsed since teardown, so
# Cost Explorer has caught up. Prints per-service spend for the last 3 days and
# flags any non-zero service (excluding tax + support, which are unavoidable).
#
# Usage:  bash cost-check.sh
# Exit codes:  0 = all clear, 1 = at least one unexpected non-zero service

set -euo pipefail

END=$(date +%Y-%m-%d)
START=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d '3 days ago' +%Y-%m-%d)
OUT=/tmp/aws-cost-check.json

echo "== AWS cost check: $START to $END =="
echo

aws ce get-cost-and-usage \
  --time-period Start="$START",End="$END" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --output json > "$OUT"

# Summarize per service
python3 - "$OUT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
totals = {}
for day in data['ResultsByTime']:
    for grp in day.get('Groups', []):
        svc = grp['Keys'][0]
        amt = float(grp['Metrics']['UnblendedCost']['Amount'])
        totals[svc] = totals.get(svc, 0.0) + amt

expected_zero_after_teardown = {
    'Amazon Elastic Container Service', 'Amazon Elastic Compute Cloud - Compute',
    'EC2 - Other', 'Amazon Relational Database Service',
    'Amazon Elastic Load Balancing', 'Amazon Elastic Container Registry',
    'Amazon Simple Storage Service', 'AWS CloudWatch',
    'AmazonCloudWatch', 'AWS Data Transfer',
}
ok_nonzero = {'Tax', 'AWS Support (Basic)', 'AWS Support (Developer)',
              'AWS Support (Business)', 'Amazon Route 53'}

problems = []
for svc, amt in sorted(totals.items(), key=lambda kv: -kv[1]):
    tag = ''
    if amt > 0.01 and svc not in ok_nonzero:
        tag = '  [!] UNEXPECTED — investigate'
        problems.append(svc)
    print(f"  ${amt:8.4f}  {svc}{tag}")

grand = sum(totals.values())
print(f"\n  TOTAL: ${grand:.4f} over 3d")

if problems:
    print(f"\n[FAIL] non-zero: {problems}")
    sys.exit(1)
else:
    print("\n[OK] no unexpected non-zero services")
PY
