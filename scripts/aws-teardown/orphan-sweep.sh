#!/usr/bin/env bash
# Sweep AWS for orphan resources that could keep costing money after teardown.
# Prints anything unexpected + exits non-zero. Safe to re-run.
#
# Usage:  bash orphan-sweep.sh
# Exit codes:  0 = no orphans, 1 = orphans found

set -uo pipefail

FAIL=0
report() { echo "  [ORPHAN] $1"; FAIL=1; }

echo "== Orphan sweep =="

# 1. Unattached EIPs (the classic $3.60/mo leak)
EIPS=$(aws ec2 describe-addresses --query 'Addresses[?AssociationId==null].AllocationId' --output text)
if [ -n "$EIPS" ]; then
  for E in $EIPS; do report "unattached EIP $E — aws ec2 release-address --allocation-id $E"; done
fi

# 2. Unattached EBS volumes
VOLS=$(aws ec2 describe-volumes --filters Name=status,Values=available \
  --query 'Volumes[].VolumeId' --output text)
if [ -n "$VOLS" ]; then
  for V in $VOLS; do report "unattached EBS volume $V"; done
fi

# 3. Manual RDS snapshots we might have forgotten
SNAPS=$(aws rds describe-db-snapshots --snapshot-type manual \
  --query "DBSnapshots[?contains(DBSnapshotIdentifier,'polemicyst') || contains(DBSnapshotIdentifier,'clipfire')].DBSnapshotIdentifier" \
  --output text)
if [ -n "$SNAPS" ]; then
  echo "  [KEPT] manual RDS snapshots retained (cost pennies/mo):"
  for S in $SNAPS; do echo "         $S"; done
fi

# 4. NAT gateways
NATS=$(aws ec2 describe-nat-gateways --filter Name=state,Values=available \
  --query 'NatGateways[?contains(Tags[?Key==`Name`].Value | [0], `polemicyst`)].NatGatewayId' \
  --output text)
if [ -n "$NATS" ]; then
  for N in $NATS; do report "NAT Gateway still active $N"; done
fi

# 5. Polemicyst VPCs
VPCS=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=polemicyst-vpc \
  --query 'Vpcs[].VpcId' --output text)
if [ -n "$VPCS" ]; then
  for V in $VPCS; do report "VPC $V (polemicyst-vpc) still exists"; done
fi

# 6. Load balancers with polemicyst in the name
LBS=$(aws elbv2 describe-load-balancers \
  --query "LoadBalancers[?contains(LoadBalancerName, 'polemicyst')].LoadBalancerArn" \
  --output text)
if [ -n "$LBS" ]; then
  for L in $LBS; do report "Load balancer still exists $L"; done
fi

# 7. Polemicyst ECS clusters
CLUSTERS=$(aws ecs list-clusters --query 'clusterArns[?contains(@, `polemicyst`)]' --output text)
if [ -n "$CLUSTERS" ]; then
  for C in $CLUSTERS; do
    STATUS=$(aws ecs describe-clusters --clusters "$C" --query 'clusters[0].status' --output text)
    [ "$STATUS" != "INACTIVE" ] && report "ECS cluster $C still $STATUS"
  done
fi

# 8. S3 buckets with polemicyst prefix
BUCKETS=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'polemicyst') || contains(Name, 'clipfire-teardown')].Name" --output text)
if [ -n "$BUCKETS" ]; then
  echo "  [FYI] S3 buckets still present (may be intentional — teardown-exports bucket is fine):"
  for B in $BUCKETS; do echo "         $B"; done
fi

# 9. ECR repos
REPOS=$(aws ecr describe-repositories --query "repositories[?contains(repositoryName, 'polemicyst')].repositoryName" --output text 2>/dev/null || true)
if [ -n "$REPOS" ]; then
  for R in $REPOS; do report "ECR repo $R still exists"; done
fi

# 10. Route 53 zone
ZONES=$(aws route53 list-hosted-zones-by-name --dns-name polemicyst.com \
  --query "HostedZones[?Name=='polemicyst.com.'].Id" --output text)
if [ -n "$ZONES" ]; then
  # This one is FYI — teardown may intentionally keep the zone if DNS hasn't cut over
  echo "  [FYI] Route 53 zone polemicyst.com still exists — expected until DNS fully cut over"
fi

# 11. ACM certs
CERTS=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='polemicyst.com'].CertificateArn" --output text)
if [ -n "$CERTS" ]; then
  for C in $CERTS; do report "ACM cert $C still exists"; done
fi

# 12. CloudWatch log groups
LGS=$(aws logs describe-log-groups --log-group-name-prefix /ecs/polemicyst \
  --query 'logGroups[].logGroupName' --output text)
if [ -n "$LGS" ]; then
  for L in $LGS; do report "CloudWatch log group $L still exists"; done
fi

# 13. Polemicyst IAM roles
ROLES=$(aws iam list-roles --query "Roles[?contains(RoleName, 'polemicyst')].RoleName" --output text)
if [ -n "$ROLES" ]; then
  for R in $ROLES; do report "IAM role $R still exists"; done
fi

echo
if [ $FAIL -eq 0 ]; then
  echo "[OK] no orphan resources found"
  exit 0
else
  echo "[FAIL] orphans present — see [ORPHAN] lines above"
  exit 1
fi
