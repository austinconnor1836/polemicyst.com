# Deployment - Next Steps

## ✅ What's Done

1. **Terraform installed** locally at `C:\Users\ac130\bin\terraform.exe`
2. **S3_REGION fixed** - Updated from us-east-2 to us-east-1 in terraform.tfvars
3. **RDS version fixed** - Set to PostgreSQL 17.6 to match current version
4. **Terraform applied successfully** - All ECS services updated with corrected environment variables
5. **Docker images exist** in ECR (pushed Jan 30, 2026)
6. **DNS configured** - Namecheap pointing to Route53 nameservers

## ⚠️ Remaining Tasks

### 1. Run Database Migrations

The RDS database is in private subnets and needs migrations run from within the VPC.

**Option A: Via AWS Console** (Easiest)
1. Go to AWS Console → ECS → Clusters → polemicyst-cluster
2. Click "Tasks" tab → "Run new task"
3. Configure:
   - **Launch type**: FARGATE
   - **Task Definition**: polemicyst-web (latest)
   - **Cluster VPC**: Select the polemicyst VPC
   - **Subnets**: Select PRIVATE subnets (subnet-078e83e418e605652, subnet-0d7564ff4f8415aae)
   - **Security group**: Select polemicyst-ecs-tasks-sg
   - **Auto-assign public IP**: DISABLED
4. Under "Advanced" → "Container Overrides":
   - **Container name**: web
   - **Command override**: `npx,prisma,migrate,deploy` (comma-separated, no spaces)
5. Click "Run task"
6. Monitor logs in CloudWatch at `/ecs/polemicyst-web`

**Option B: Via AWS CLI**

If AWS CLI is installed locally:

```bash
aws ecs run-task \
  --cluster polemicyst-cluster \
  --task-definition polemicyst-web \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-078e83e418e605652,subnet-0d7564ff4f8415aae],securityGroups=[sg-09a27b41866a5e5eb],assignPublicIp=DISABLED}" \
  --overrides file://infrastructure/migration-overrides.json
```

The `migration-overrides.json` file is already created in the infrastructure directory.

**Option C: Via Docker + AWS CLI**

```powershell
cd C:\Users\ac130\Developer\polemicyst.com\infrastructure

docker run --rm `
  -v "$PWD:/workspace" `
  -w /workspace `
  -e AWS_ACCESS_KEY_ID `
  -e AWS_SECRET_ACCESS_KEY `
  -e AWS_DEFAULT_REGION=us-east-1 `
  amazon/aws-cli ecs run-task `
  --cluster polemicyst-cluster `
  --task-definition polemicyst-web `
  --launch-type FARGATE `
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-078e83e418e605652,subnet-0d7564ff4f8415aae],securityGroups=[sg-09a27b41866a5e5eb],assignPublicIp=DISABLED}' `
  --overrides file://migration-overrides.json
```

### 2. Verify Deployment

After migrations complete:

#### Check ECS Services
```bash
# Via AWS Console: ECS → Clusters → polemicyst-cluster → Services
# Or via CLI:
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-web clip-worker redis
```

Look for:
- **Running count** matches **Desired count**
- **Health status**: HEALTHY
- **Latest deployment** is active

#### Check ALB Target Health
```bash
# Via AWS Console: EC2 → Target Groups → polemicyst-web-tg
# Or via CLI (need target group ARN):
aws elbv2 describe-target-health --target-group-arn <arn>
```

#### Test the Website

1. **Wait for DNS propagation** (can take up to 48 hours, but usually faster)
   ```bash
   nslookup polemicyst.com
   ```
   Should resolve to ALB IP addresses

2. **Visit https://polemicyst.com**
   - Should load the site
   - Check if SSL certificate is valid
   - Try logging in with Google OAuth
   - Test uploading a video

3. **Check logs** if issues:
   ```bash
   # Via AWS Console: CloudWatch → Log groups → /ecs/polemicyst-web
   # Or via CLI:
   aws logs tail /ecs/polemicyst-web --follow
   ```

### 3. Monitor Workers

Worker logs:
```bash
aws logs tail /ecs/polemicyst-clip-worker --follow
aws logs tail /ecs/polemicyst-provocativeness --follow  # If scaled up
aws logs tail /ecs/polemicyst-comedic --follow  # If scaled up
```

## Troubleshooting

### Site Not Loading
1. Check ALB listener rules and target group health
2. Verify ECS tasks are running and healthy
3. Check CloudWatch logs for errors
4. Verify security groups allow traffic (ALB → ECS tasks → RDS)

### Database Connection Errors
1. Verify DATABASE_URL in task definition is correct
2. Check RDS security group allows traffic from ECS security group
3. Verify RDS is in same VPC as ECS tasks
4. Check RDS is running (not stopped for cost savings)

### S3 Upload/Access Errors
1. Check S3_BUCKET and S3_REGION env vars are set correctly in task definitions
2. Verify ECS task IAM role has S3 permissions
3. Check bucket policy allows ECS task role
4. Old database rows may still reference us-east-2 bucket

### Workers Not Processing
1. Check Redis service is running: `aws ecs describe-services --cluster polemicyst-cluster --services redis`
2. Verify worker environment variables match API settings
3. Check worker logs for connection errors
4. Ensure queue names match between API routes and workers

## Cost Optimization Tips

1. **LLM Workers**: Keep scaled to 0 when not in use
   ```bash
   aws ecs update-service --cluster polemicyst-cluster --service provocativeness-scorer --desired-count 0
   aws ecs update-service --cluster polemicyst-cluster --service comedic-scorer --desired-count 0
   ```

2. **RDS**: Consider stopping during off-hours (manually or via Lambda scheduler)

3. **CloudFront**: Add CDN in front of S3 for better caching and reduced data transfer costs

4. **Monitoring**: Set up CloudWatch alarms for unusual activity or costs

## Future Enhancements

1. **Auto-scaling**: Add Application Auto Scaling for ECS services based on CPU/memory
2. **CI/CD improvements**: Add blue/green deployments or canary releases
3. **Monitoring**: Add APM (DataDog, New Relic) or CloudWatch Container Insights
4. **Backup**: Automate RDS snapshots and test restore procedures
5. **Multi-region**: Add additional regions for better global performance
6. **CloudFront**: CDN for static assets and S3 content

## Quick Reference

**Terraform commands:**
```bash
cd infrastructure
C:\Users\ac130\bin\terraform.exe plan
C:\Users\ac130\bin\terraform.exe apply
C:\Users\ac130\bin\terraform.exe output
```

**Useful AWS Resources:**
- VPC ID: `vpc-0f3795c3b533fe1aa`
- RDS Endpoint: `polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com`
- ALB DNS: `polemicyst-alb-479641305.us-east-1.elb.amazonaws.com`
- S3 Bucket: `polemicyst-uploads-prod`
- ECR Repositories:
  - `746669200861.dkr.ecr.us-east-1.amazonaws.com/polemicyst-web`
  - `746669200861.dkr.ecr.us-east-1.amazonaws.com/polemicyst-clip-worker`
  - `746669200861.dkr.ecr.us-east-1.amazonaws.com/polemicyst-llm-worker`

**GitHub Actions:**
- Repository secrets needed: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Triggers on push to `main` or `develop` branches
- Builds and pushes Docker images, then forces ECS deployments
