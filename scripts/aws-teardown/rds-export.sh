#!/usr/bin/env bash
# Export an RDS snapshot to S3 as parquet — this is what makes the backup PORTABLE
# off AWS. A raw RDS snapshot can only be restored inside AWS RDS. A parquet export
# can be sucked into anything (Neon via COPY, DuckDB, local Postgres, etc.).
#
# Usage:  bash rds-export.sh <env>     # env = prod | dev
#
# Requires the AWS account to have a KMS key + IAM role for RDS export. This script
# CREATES them on demand (with tag Purpose=aws-teardown-export) and prints instructions
# to delete them after. If you already have one, set:
#   RDS_EXPORT_KMS_KEY_ARN=...
#   RDS_EXPORT_ROLE_ARN=...
# to reuse instead.
#
# Bucket: clipfire-teardown-exports (created if missing)

set -euo pipefail

ENV="${1:?usage: rds-export.sh <prod|dev>}"
DATE=$(date +%Y-%m-%d)
SNAP_ID="clipfire-final-${ENV}-${DATE}"
EXPORT_ID="clipfire-final-${ENV}-export-${DATE}"
BUCKET="clipfire-teardown-exports"
REGION="us-east-1"

echo "== RDS export to S3: $SNAP_ID -> s3://$BUCKET/$ENV/ =="

# 1. Confirm snapshot exists + is available
STATUS=$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP_ID" \
  --query 'DBSnapshots[0].Status' --output text 2>/dev/null || echo "NONE")
if [ "$STATUS" != "available" ]; then
  echo "[ERR] Snapshot $SNAP_ID not available (status: $STATUS). Run rds-snapshot.sh first."
  exit 1
fi
SNAP_ARN=$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP_ID" \
  --query 'DBSnapshots[0].DBSnapshotArn' --output text)

# 2. Ensure export bucket exists
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "[CREATE] Creating export bucket s3://$BUCKET"
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  aws s3api put-bucket-tagging --bucket "$BUCKET" \
    --tagging 'TagSet=[{Key=Purpose,Value=aws-teardown-export}]'
fi

# 3. Ensure KMS key
if [ -z "${RDS_EXPORT_KMS_KEY_ARN:-}" ]; then
  RDS_EXPORT_KMS_KEY_ARN=$(aws kms create-key \
    --description "Ephemeral key for RDS teardown export ${DATE}" \
    --tags TagKey=Purpose,TagValue=aws-teardown-export \
    --query 'KeyMetadata.Arn' --output text)
  echo "[CREATE] Created KMS key: $RDS_EXPORT_KMS_KEY_ARN"
fi

# 4. Ensure IAM role for RDS export
ROLE_NAME="clipfire-rds-export-role"
if [ -z "${RDS_EXPORT_ROLE_ARN:-}" ]; then
  if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "[CREATE] Creating IAM role $ROLE_NAME"
    aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "export.rds.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }'
    aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name S3ExportAccess --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [
        {\"Effect\": \"Allow\", \"Action\": [\"s3:PutObject*\", \"s3:ListBucket\", \"s3:GetObject*\", \"s3:DeleteObject*\", \"s3:GetBucketLocation\"], \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"]}
      ]
    }"
    # IAM propagation delay
    sleep 15
  fi
  RDS_EXPORT_ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
fi

# 5. Start (or check) the export task
EXISTING_STATUS=$(aws rds describe-export-tasks --export-task-identifier "$EXPORT_ID" \
  --query 'ExportTasks[0].Status' --output text 2>/dev/null || echo "NONE")

case "$EXISTING_STATUS" in
  COMPLETE)
    echo "[OK] Export $EXPORT_ID already complete. No-op."
    exit 0
    ;;
  STARTING|IN_PROGRESS)
    echo "[WAIT] Export $EXPORT_ID in progress. Polling until complete..."
    ;;
  FAILED|CANCELED)
    echo "[ERR] Export $EXPORT_ID previously $EXISTING_STATUS. Delete + retry manually."
    exit 1
    ;;
  NONE)
    echo "[START] Starting export $EXPORT_ID"
    aws rds start-export-task \
      --export-task-identifier "$EXPORT_ID" \
      --source-arn "$SNAP_ARN" \
      --s3-bucket-name "$BUCKET" \
      --s3-prefix "$ENV/" \
      --iam-role-arn "$RDS_EXPORT_ROLE_ARN" \
      --kms-key-id "$RDS_EXPORT_KMS_KEY_ARN"
    ;;
esac

# 6. Poll until complete
while true; do
  STATUS=$(aws rds describe-export-tasks --export-task-identifier "$EXPORT_ID" \
    --query 'ExportTasks[0].Status' --output text)
  echo "[POLL] $EXPORT_ID = $STATUS ($(date +%H:%M:%S))"
  case "$STATUS" in
    COMPLETE) break ;;
    FAILED|CANCELED)
      echo "[ERR] Export ended in $STATUS"
      aws rds describe-export-tasks --export-task-identifier "$EXPORT_ID" \
        --query 'ExportTasks[0].FailureCause'
      exit 1
      ;;
  esac
  sleep 60
done

echo "[OK] Export complete: s3://$BUCKET/$ENV/"
echo "[NEXT] aws s3 sync s3://$BUCKET/$ENV/ ~/backups/clipfire/rds-${ENV}-final/"
