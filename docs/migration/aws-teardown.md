# AWS Teardown Checklist — Clipfire / polemicyst.com

Manual AWS console + CLI teardown, executed **after** the new stack (Cloudflare R2 + Neon + Upstash + Vercel + Fly.io) is live and verified. This is the plan Austin executes at the keyboard. Nothing here is fired by an agent — every command is written for a human to run and verify.

- **Region:** `us-east-1`
- **Account:** `746669200861`
- **Pre-launch, no live users.** No customer downtime windows to schedule around.
- **Terraform state is NOT on this Mac.** It lives on the other MacBook. This teardown is **manual by design** — `terraform destroy` is not the plan. Once every resource is gone, the `.tf` files can be archived (see the "Terraform state fate" section at the end).

## Ground rules

1. **Never delete anything until backups are proven.** Phase 1 must complete + verify before touching Phase 2.
2. **Run `scripts/aws-teardown/preflight.sh` before each destructive phase.** If the new stack is unhealthy, destructive steps abort. This is the safety net.
3. **Every step has a verify command.** If a verify fails, stop and re-run — do not skip to the next step.
4. **Resumable.** All scripts are idempotent; a re-run on a partially-completed step is a no-op.
5. **Snapshots are cheap (pennies/mo).** Keep the final RDS snapshot for 90 days as a "just in case" — cost is negligible. Flag it in a calendar reminder to delete.
6. **The EIP trap.** Releasing a NAT Gateway does NOT release its EIP. A dangling EIP costs ~$3.60/mo forever. Phase 6 explicitly releases it.
7. **Route 53 is LAST.** Deleting the hosted zone before DNS is fully cut over to Cloudflare breaks everything. It's the final destructive step.

---

## Inventory (what we're deleting)

Straight from `infrastructure/*.tf`:

| Layer    | Resource                                           | Count       | Notes                                                                                 |
| -------- | -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| App      | ECS cluster `polemicyst-cluster`                   | 1           |                                                                                       |
| App      | ECS services                                       | 10          | 5 services × 2 envs (`web`, `clip-worker`, `redis`, `provocativeness`, `comedic`)     |
| App      | ECS task definitions                               | 10 families | deregister all revisions                                                              |
| App      | Auto-scaling targets + policies                    | 8           | web + clip-worker × 2 envs, CPU + request policies                                    |
| App      | Service Discovery namespace `polemicyst.local`     | 1           | + redis services × 2 envs                                                             |
| Net      | ALB `polemicyst-alb`                               | 1           | + 2 listeners (80/443) + 2 target groups (`prod`, `dev`) + host-routing rules         |
| Data     | RDS Postgres                                       | 2           | `polemicyst-prod-db`, `polemicyst-dev-db`                                             |
| Data     | DB subnet group `polemicyst-db-subnets`            | 1           |                                                                                       |
| Data     | S3 bucket                                          | 1           | `polemicyst-uploads-prod` (per var; may also be `polemicyst-uploads-dev` if separate) |
| Registry | ECR repos                                          | 3           | `polemicyst-web`, `polemicyst-clip-worker`, `polemicyst-llm-worker`                   |
| VPC      | VPC `10.0.0.0/16`                                  | 1           |                                                                                       |
| VPC      | Subnets (2 public, 2 private)                      | 4           |                                                                                       |
| VPC      | Internet Gateway                                   | 1           |                                                                                       |
| VPC      | NAT Gateway + EIP                                  | 1 each      | **EIP release is separate step**                                                      |
| VPC      | Route tables (1 public + 2 private)                | 3           |                                                                                       |
| VPC      | Interface endpoints (`ecr.dkr`, `ecr.api`, `logs`) | 3           |                                                                                       |
| VPC      | Gateway endpoint (`s3`)                            | 1           |                                                                                       |
| VPC      | Security groups (`alb`, `ecs_tasks`, `rds`)        | 3           |                                                                                       |
| DNS      | Route 53 hosted zone `polemicyst.com`              | 1           | + all records; **last thing to delete**                                               |
| TLS      | ACM cert for `polemicyst.com` + SANs               | 1           |                                                                                       |
| IAM      | Roles: `ecs_task_execution_role`, `ecs_task_role`  | 2           | + attached policies                                                                   |
| Logs     | CloudWatch Log Groups `/ecs/polemicyst-*`          | ~10         | one per (env × service)                                                               |

---

### Phase 0 — Preflight (must pass before ANY destructive step)

- [ ] 0.1 Confirm new stack is live
      Command: `bash scripts/aws-teardown/preflight.sh`
      Verify: exit code `0`. On failure, STOP — the new stack is not ready.

- [ ] 0.2 Confirm AWS credentials point at account 746669200861
      Command: `aws sts get-caller-identity`
      Verify: `Account` field = `746669200861`.

- [ ] 0.3 Confirm region default
      Command: `aws configure get region`
      Verify: `us-east-1`.

---

### Phase 1 — Backup (must complete before Phase 2)

- [ ] 1.1 Verify Neon prod has data + smoke-passes
      Command: `psql "$NEON_PROD_URL" -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM "Video"; SELECT count(*) FROM "Clip";'`
      Verify: all three counts are non-zero (or match what you expect from pre-migration).

- [ ] 1.2 Snapshot RDS prod (final)
      Command: `bash scripts/aws-teardown/rds-snapshot.sh prod`
      Verify: `aws rds describe-db-snapshots --db-snapshot-identifier clipfire-final-prod-$(date +%Y-%m-%d) --query 'DBSnapshots[0].Status'` = `"available"`

- [ ] 1.3 Snapshot RDS dev (final)
      Command: `bash scripts/aws-teardown/rds-snapshot.sh dev`
      Verify: `aws rds describe-db-snapshots --db-snapshot-identifier clipfire-final-dev-$(date +%Y-%m-%d) --query 'DBSnapshots[0].Status'` = `"available"`

- [ ] 1.4 Export prod snapshot to S3 as parquet (portable, restorable to Neon/Postgres via COPY)
      Command: `bash scripts/aws-teardown/rds-export.sh prod`
      Verify: `aws rds describe-export-tasks --export-task-identifier clipfire-final-prod-export --query 'ExportTasks[0].Status'` = `"COMPLETE"` (takes 20-60 min).
      Note: RDS-to-S3 export requires a KMS key + IAM role — the script creates + tears down a short-lived one. If you skip this and rely only on the snapshot, you lock yourself into AWS-only restore.

- [ ] 1.5 Download the export tarball off AWS to local disk
      Command: `aws s3 sync s3://clipfire-teardown-exports/prod/ ~/backups/clipfire/rds-prod-final/`
      Verify: `du -sh ~/backups/clipfire/rds-prod-final/` returns non-zero size.

- [ ] 1.6 Sync S3 media bucket to R2 (idempotent — safe to re-run)
      Command: `bash scripts/aws-teardown/s3-to-r2-sync.sh`
      Verify: script re-runs and reports `0 objects to copy` on second pass.

- [ ] 1.7 Snapshot ECR image tags (record what was in production in case of rebuild)
      Command: `bash scripts/aws-teardown/ecr-inventory.sh > ~/backups/clipfire/ecr-inventory-$(date +%Y-%m-%d).json`
      Verify: file exists and contains `web`, `clip-worker`, `llm-worker` keys.

- [ ] 1.8 Export Route 53 zone records (in case you need to restore or replay to Cloudflare)
      Command: `aws route53 list-resource-record-sets --hosted-zone-id "$(aws route53 list-hosted-zones-by-name --dns-name polemicyst.com --query 'HostedZones[0].Id' --output text)" > ~/backups/clipfire/route53-polemicyst-$(date +%Y-%m-%d).json`
      Verify: file exists and contains `NS`, `SOA`, and the ALB alias `A` records.

---

### Phase 2 — App layer down (ECS services)

Order: scale services to 0 → wait for tasks to drain → delete services. Deleting a service with running tasks fails; scaling to 0 first avoids the "force" flag and lets circuit breakers behave.

- [ ] 2.1 Disable auto-scaling on all services (so nothing scales up mid-teardown)
      Command: `bash scripts/aws-teardown/disable-autoscaling.sh`
      Verify: `aws application-autoscaling describe-scalable-targets --service-namespace ecs --query 'ScalableTargets[?contains(ResourceId, `polemicyst`)]'` returns `[]`.

- [ ] 2.2 Scale all ECS services to `desired_count=0`
      Command: `bash scripts/aws-teardown/ecs-scale-to-zero.sh`
      Verify: `aws ecs list-services --cluster polemicyst-cluster --query 'serviceArns' | xargs -I {} aws ecs describe-services --cluster polemicyst-cluster --services {} --query 'services[].[serviceName,desiredCount,runningCount]' --output table` shows `0 / 0` for every row.

- [ ] 2.3 Wait for all tasks to stop (up to 5 min)
      Command: `aws ecs list-tasks --cluster polemicyst-cluster --query 'taskArns'`
      Verify: returns `[]`.

- [ ] 2.4 Delete all ECS services
      Command: `bash scripts/aws-teardown/ecs-delete-services.sh`
      Verify: `aws ecs list-services --cluster polemicyst-cluster --query 'serviceArns'` returns `[]`.

- [ ] 2.5 Deregister all task definition revisions (all families)
      Command: `bash scripts/aws-teardown/ecs-deregister-task-defs.sh`
      Verify: `aws ecs list-task-definitions --status ACTIVE --family-prefix polemicyst --query 'taskDefinitionArns'` returns `[]`.

- [ ] 2.6 Delete Service Discovery services + namespace
      Command: |
  ```
  for env in prod dev; do
    ID=$(aws servicediscovery list-services --query "Services[?Name=='redis-$env'].Id | [0]" --output text)
    [ "$ID" != "None" ] && aws servicediscovery delete-service --id "$ID"
  done
  NS_ID=$(aws servicediscovery list-namespaces --query "Namespaces[?Name=='polemicyst.local'].Id | [0]" --output text)
  [ "$NS_ID" != "None" ] && aws servicediscovery delete-namespace --id "$NS_ID"
  ```
  Verify: `aws servicediscovery list-namespaces --query "Namespaces[?Name=='polemicyst.local']"` returns `[]`.

---

### Phase 3 — Delete ALB (target groups + listeners + LB)

- [ ] 3.1 Delete both listeners (must be deleted before the LB)
      Command: |

  ```
  LB_ARN=$(aws elbv2 describe-load-balancers --names polemicyst-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  for L in $(aws elbv2 describe-listeners --load-balancer-arn "$LB_ARN" --query 'Listeners[].ListenerArn' --output text); do
    aws elbv2 delete-listener --listener-arn "$L"
  done
  ```

  Verify: `aws elbv2 describe-listeners --load-balancer-arn "$LB_ARN" --query 'Listeners'` returns `[]`.

- [ ] 3.2 Delete the load balancer
      Command: `aws elbv2 delete-load-balancer --load-balancer-arn "$LB_ARN"`
      Verify: `aws elbv2 describe-load-balancers --names polemicyst-alb 2>&1 | grep -q "LoadBalancerNotFound"` returns exit 0.

- [ ] 3.3 Delete both target groups (`polemicyst-prod-web-tg`, `polemicyst-dev-web-tg`)
      Command: |
  ```
  for TG in polemicyst-prod-web-tg polemicyst-dev-web-tg; do
    ARN=$(aws elbv2 describe-target-groups --names "$TG" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)
    [ -n "$ARN" ] && [ "$ARN" != "None" ] && aws elbv2 delete-target-group --target-group-arn "$ARN"
  done
  ```
  Verify: `aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName,'polemicyst')]"` returns `[]`.

---

### Phase 4 — Delete ECS cluster

- [ ] 4.1 Delete cluster (must be empty — verified in Phase 2)
      Command: `aws ecs delete-cluster --cluster polemicyst-cluster`
      Verify: `aws ecs describe-clusters --clusters polemicyst-cluster --query 'clusters[0].status'` = `"INACTIVE"` or resource not found.

---

### Phase 5 — Delete RDS instances

**Deletion protection is enabled in prod (`db_deletion_protection = true`).** Must disable first.

- [ ] 5.1 Disable deletion protection on prod
      Command: `aws rds modify-db-instance --db-instance-identifier polemicyst-prod-db --no-deletion-protection --apply-immediately`
      Verify: `aws rds describe-db-instances --db-instance-identifier polemicyst-prod-db --query 'DBInstances[0].DeletionProtection'` = `false`.

- [ ] 5.2 Wait for the modify to complete (usually 30s-2min)
      Command: `aws rds wait db-instance-available --db-instance-identifier polemicyst-prod-db`
      Verify: exit 0.

- [ ] 5.3 Delete prod RDS (skip-final-snapshot because Phase 1.2 already snapshotted)
      Command: `aws rds delete-db-instance --db-instance-identifier polemicyst-prod-db --skip-final-snapshot --delete-automated-backups`
      Verify: `aws rds describe-db-instances --db-instance-identifier polemicyst-prod-db --query 'DBInstances[0].DBInstanceStatus'` returns `"deleting"` then eventually `DBInstanceNotFound`.

- [ ] 5.4 Delete dev RDS (deletion-protection off per config, skip-final-snapshot ok because we snapshotted in 1.3)
      Command: `aws rds delete-db-instance --db-instance-identifier polemicyst-dev-db --skip-final-snapshot --delete-automated-backups`
      Verify: eventually `DBInstanceNotFound`.

- [ ] 5.5 Wait for BOTH to reach `deleted` state (takes 5-15 min)
      Command: `aws rds wait db-instance-deleted --db-instance-identifier polemicyst-prod-db && aws rds wait db-instance-deleted --db-instance-identifier polemicyst-dev-db`
      Verify: exit 0.

- [ ] 5.6 Delete the DB subnet group (must be empty of instances first)
      Command: `aws rds delete-db-subnet-group --db-subnet-group-name polemicyst-db-subnets`
      Verify: `aws rds describe-db-subnet-groups --db-subnet-group-name polemicyst-db-subnets 2>&1 | grep -q "DBSubnetGroupNotFoundFault"` returns 0.

---

### Phase 6 — Delete NAT + release EIP (immediate cost drop)

NAT hourly + per-GB is where dev-side spend concentrates. Killing this ~immediately stops NAT charges. **The EIP is a separate resource and MUST be explicitly released** — otherwise $3.60/mo forever for an unattached IP.

- [ ] 6.1 Find + delete NAT Gateway
      Command: |

  ```
  NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=tag:Name,Values=polemicyst-nat-0" --query 'NatGateways[?State!=`deleted`].NatGatewayId | [0]' --output text)
  [ "$NAT_ID" != "None" ] && aws ec2 delete-nat-gateway --nat-gateway-id "$NAT_ID"
  ```

  Verify: `aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].State'` shows `deleting` then eventually `deleted`.

- [ ] 6.2 Wait for NAT to be fully deleted (takes ~2 min)
      Command: `until [ "$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].State' --output text)" = "deleted" ]; do sleep 15; done`
      Verify: `deleted`.

- [ ] 6.3 **RELEASE the Elastic IP** (this is the trap — Terraform-created EIPs don't auto-release with NAT deletion via console)
      Command: |
  ```
  EIP_ALLOC=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=polemicyst-*" --query 'Addresses[?AssociationId==null].AllocationId | [0]' --output text)
  # Fallback: any unattached EIP in the account
  [ "$EIP_ALLOC" = "None" ] && EIP_ALLOC=$(aws ec2 describe-addresses --query 'Addresses[?AssociationId==null].AllocationId | [0]' --output text)
  [ "$EIP_ALLOC" != "None" ] && aws ec2 release-address --allocation-id "$EIP_ALLOC"
  ```
  Verify: `aws ec2 describe-addresses --query 'Addresses[?AssociationId==null]'` returns `[]`. **This is the single most important cost-hygiene step.**

---

### Phase 7 — Delete VPC endpoints, subnets, IGW, SGs, VPC

VPC deletion fails with cryptic "DependencyViolation" errors if any child resource remains. Order matters:

- [ ] 7.1 Delete all VPC endpoints (interface + gateway)
      Command: |

  ```
  VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=polemicyst-vpc" --query 'Vpcs[0].VpcId' --output text)
  for EP in $(aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$VPC_ID" --query 'VpcEndpoints[].VpcEndpointId' --output text); do
    aws ec2 delete-vpc-endpoints --vpc-endpoint-ids "$EP"
  done
  ```

  Verify: `aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$VPC_ID" --query 'VpcEndpoints'` returns `[]`.

- [ ] 7.2 Delete route table associations (except main), then non-main route tables
      Command: |

  ```
  for RT in $(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" --query 'RouteTables[?Associations[0].Main!=`true`].RouteTableId' --output text); do
    for ASSOC in $(aws ec2 describe-route-tables --route-table-ids "$RT" --query 'RouteTables[0].Associations[?Main!=`true`].RouteTableAssociationId' --output text); do
      aws ec2 disassociate-route-table --association-id "$ASSOC"
    done
    aws ec2 delete-route-table --route-table-id "$RT"
  done
  ```

  Verify: `aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" --query "RouteTables[?Associations[0].Main!=\`true\`]"`returns`[]`.

- [ ] 7.3 Delete all subnets (public + private)
      Command: |

  ```
  for SN in $(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text); do
    aws ec2 delete-subnet --subnet-id "$SN"
  done
  ```

  Verify: `aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets'` returns `[]`.

- [ ] 7.4 Detach + delete Internet Gateway
      Command: |

  ```
  IGW_ID=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC_ID" --query 'InternetGateways[0].InternetGatewayId' --output text)
  aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
  ```

  Verify: `aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC_ID" --query 'InternetGateways'` returns `[]`.

- [ ] 7.5 Delete security groups (`alb`, `ecs_tasks`, `rds`) — cross-SG refs must all be gone first
      Command: |

  ```
  for SG_NAME in polemicyst-alb-sg polemicyst-ecs-tasks-sg polemicyst-rds-sg; do
    SG_ID=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$SG_NAME" --query 'SecurityGroups[0].GroupId' --output text)
    [ "$SG_ID" != "None" ] && aws ec2 delete-security-group --group-id "$SG_ID"
  done
  ```

  Verify: `aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query "SecurityGroups[?GroupName!='default'].GroupId"` returns `[]`.

- [ ] 7.6 Delete the VPC
      Command: `aws ec2 delete-vpc --vpc-id "$VPC_ID"`
      Verify: `aws ec2 describe-vpcs --filters "Name=tag:Name,Values=polemicyst-vpc" --query 'Vpcs'` returns `[]`.

---

### Phase 8 — Empty + delete S3 bucket

Requires Phase 1.6 (R2 sync) complete + verified. `s3_force_destroy = false` by default in Terraform, so the bucket has objects — must be emptied first.

- [ ] 8.1 Re-verify R2 has parity with S3 (last-chance check)
      Command: `bash scripts/aws-teardown/s3-to-r2-sync.sh --verify-only`
      Verify: exit 0 and message `S3 and R2 are in parity`.

- [ ] 8.2 Empty the bucket (all versions + delete-markers if versioning was ever on)
      Command: `bash scripts/aws-teardown/s3-empty-bucket.sh polemicyst-uploads-prod`
      Verify: `aws s3api list-objects-v2 --bucket polemicyst-uploads-prod --query 'KeyCount'` = `0`.

- [ ] 8.3 Delete the bucket
      Command: `aws s3api delete-bucket --bucket polemicyst-uploads-prod`
      Verify: `aws s3api head-bucket --bucket polemicyst-uploads-prod 2>&1 | grep -q "Not Found"` returns 0.

- [ ] 8.4 Repeat 8.1-8.3 for any per-env bucket if it exists (e.g. `polemicyst-uploads-dev`)
      Command: `bash scripts/aws-teardown/s3-empty-bucket.sh polemicyst-uploads-dev && aws s3api delete-bucket --bucket polemicyst-uploads-dev`
      Verify: same as 8.3.

---

### Phase 9 — Delete ECR repos

- [ ] 9.1 Confirm ECR image inventory saved (from Phase 1.7)
      Command: `test -f ~/backups/clipfire/ecr-inventory-*.json && echo ok`
      Verify: `ok`.

- [ ] 9.2 Delete all three repos (Terraform sets `force_delete = true`, so tagged images are removed with the repo)
      Command: |
  ```
  for REPO in polemicyst-web polemicyst-clip-worker polemicyst-llm-worker; do
    aws ecr delete-repository --repository-name "$REPO" --force
  done
  ```
  Verify: `aws ecr describe-repositories --query "repositories[?contains(repositoryName, 'polemicyst')]"` returns `[]`.

---

### Phase 10 — Delete CloudWatch log groups

- [ ] 10.1 Delete all `/ecs/polemicyst-*` log groups
      Command: |
  ```
  for LG in $(aws logs describe-log-groups --log-group-name-prefix /ecs/polemicyst --query 'logGroups[].logGroupName' --output text); do
    aws logs delete-log-group --log-group-name "$LG"
  done
  ```
  Verify: `aws logs describe-log-groups --log-group-name-prefix /ecs/polemicyst --query 'logGroups'` returns `[]`.

---

### Phase 11 — Delete IAM roles

- [ ] 11.1 Detach + delete `polemicyst-ecs-task-execution-role`
      Command: |

  ```
  ROLE=polemicyst-ecs-task-execution-role
  for POL in $(aws iam list-attached-role-policies --role-name $ROLE --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-role-policy --role-name $ROLE --policy-arn "$POL"
  done
  aws iam delete-role --role-name $ROLE
  ```

  Verify: `aws iam get-role --role-name polemicyst-ecs-task-execution-role 2>&1 | grep -q NoSuchEntity` returns 0.

- [ ] 11.2 Delete inline policy + role `polemicyst-ecs-task-role`
      Command: |
  ```
  ROLE=polemicyst-ecs-task-role
  for POL in $(aws iam list-role-policies --role-name $ROLE --query 'PolicyNames' --output text); do
    aws iam delete-role-policy --role-name $ROLE --policy-name "$POL"
  done
  aws iam delete-role --role-name $ROLE
  ```
  Verify: `aws iam get-role --role-name polemicyst-ecs-task-role 2>&1 | grep -q NoSuchEntity` returns 0.

---

### Phase 12 — Route 53 (DNS cutover MUST be complete first)

**STOP.** Before running any of these steps: confirm `polemicyst.com` is delegated to **Cloudflare** nameservers (or wherever the new DNS lives), and has been for at least 48h. Deleting the hosted zone before the delegation propagates will break the site.

- [ ] 12.1 Verify current NS records on the registrar side point AWAY from Route 53
      Command: `dig +short NS polemicyst.com @8.8.8.8`
      Verify: nameservers returned do NOT contain `awsdns` in them (i.e. they're Cloudflare's `*.ns.cloudflare.com`).

- [ ] 12.2 Delete every non-NS/non-SOA record in the zone (AWS won't let you delete a zone that has other records)
      Command: |

  ```
  ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name polemicyst.com --query 'HostedZones[0].Id' --output text)
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Type!='NS' && Type!='SOA']" \
    > /tmp/route53-records-to-delete.json
  # Build a change batch of DELETE actions and apply
  python3 -c "
  import json, sys
  recs = json.load(open('/tmp/route53-records-to-delete.json'))
  changes = [{'Action': 'DELETE', 'ResourceRecordSet': r} for r in recs]
  json.dump({'Changes': changes}, open('/tmp/route53-change-batch.json', 'w'))
  print(f'Prepared {len(changes)} DELETE actions')
  "
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file:///tmp/route53-change-batch.json
  ```

  Verify: `aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" --query "ResourceRecordSets[?Type!='NS' && Type!='SOA']"` returns `[]`.

- [ ] 12.3 Delete the hosted zone
      Command: `aws route53 delete-hosted-zone --id "$ZONE_ID"`
      Verify: `aws route53 list-hosted-zones-by-name --dns-name polemicyst.com --query "HostedZones[?Name=='polemicyst.com.']"` returns `[]`.

---

### Phase 13 — ACM cert cleanup

- [ ] 13.1 Delete the cert (must be uninstalled from ALB, which was deleted in Phase 3)
      Command: |
  ```
  CERT_ARN=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='polemicyst.com'].CertificateArn | [0]" --output text)
  [ "$CERT_ARN" != "None" ] && aws acm delete-certificate --certificate-arn "$CERT_ARN"
  ```
  Verify: `aws acm list-certificates --query "CertificateSummaryList[?DomainName=='polemicyst.com']"` returns `[]`.

---

### Phase 14 — Post-teardown cost verification

- [ ] 14.1 Wait ~24h for AWS Cost Explorer to reflect the teardown
      (No command — just time.)

- [ ] 14.2 Run cost check
      Command: `bash scripts/aws-teardown/cost-check.sh`
      Verify: exit 0. The script prints per-service spend for the last 3 days and flags any non-zero service other than tax + support.

- [ ] 14.3 Orphan sweep (final grep)
      Command: `bash scripts/aws-teardown/orphan-sweep.sh`
      Verify: exit 0 with output `no orphan resources found`.

- [ ] 14.4 Decide on final RDS snapshots
      If keeping (recommended): calendar reminder for +90 days to run
      `aws rds delete-db-snapshot --db-snapshot-identifier clipfire-final-prod-YYYY-MM-DD`
      If deleting now: same command, today. Storage cost is pennies/mo — the risk of prematurely deleting the only off-Neon copy of the data is not worth it.

---

## Terraform state fate

The `terraform.tfstate` is on Austin's other Mac and is intentionally NOT used for this teardown. Two options after Phase 14:

1. **Recommended: archive + delete the `.tf` files.** Once every AWS resource is gone, the Terraform config is a description of a system that no longer exists. Move `infrastructure/` to `infrastructure.archive/` (or delete it), commit, and let the git history be the record. The state file on the other Mac becomes irrelevant — you can delete it safely once you confirm this teardown is complete.
2. **Alternative: import the state, then `terraform destroy` for a sanity check.** Only useful if you want a Terraform-clean paper trail. Adds days of work (importing all resources), and by the time you finish, the manual teardown is done. Not worth it here.

## Cost of doing nothing

If Austin isn't ready to migrate for weeks, the hibernation math is:

| Resource                              | If left running                    | Notes                                                                                           |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| ECS Fargate tasks                     | ~$300-500/mo                       | The big one — scale desired_count to 0 immediately if you want to pause                         |
| NAT Gateway                           | ~$32/mo (idle) + $0.045/GB traffic | Idle-hour cost alone is ~$32/mo. Delete NAT + release EIP is a 5-min job that alone saves that. |
| RDS `db.t3.small` × 2 (Multi-AZ prod) | ~$60-100/mo                        | Snapshot + delete instances if not using                                                        |
| ALB (idle)                            | ~$16/mo                            | LCU billing kicks up under load; idle is ~$16                                                   |
| S3 storage                            | ~$0.023/GB/mo                      | Cheap; the bandwidth on syncing OUT to R2 is where you pay                                      |
| Route 53 hosted zone                  | $0.50/mo + queries                 | Rounds to $1/mo                                                                                 |
| ECR (10 tagged images × 3 repos)      | ~$0.10/mo per GB stored            | Trivial                                                                                         |
| EIP (unattached)                      | **~$3.60/mo per**                  | The trap — verify all EIPs are released, not just NAT deleted                                   |
| Final RDS snapshots                   | Pennies/mo per snapshot            | Keep for 90 days as insurance                                                                   |

**Hibernation-only plan (partial teardown for a few weeks):** run Phase 2 (scale to 0) + Phase 5 (delete RDS after snapshot) + Phase 6 (NAT + EIP). That kills 95% of the spend and leaves the network fabric intact for a quick restore.

## Snapshot the plan

- Preflight → Backup → App down → ALB down → Cluster down → RDS down → NAT/EIP down → VPC down → S3 down → ECR down → Logs down → IAM down → Route 53 down → ACM down → Verify.
- Every step has a verify. Every risky step has a script. The whole plan is resumable.
