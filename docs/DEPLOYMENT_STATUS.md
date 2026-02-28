# Deployment Status & Next Steps

**Last Updated:** 2026-02-09 23:45 UTC

## Current Status

### ✅ Completed

1. **Multi-Environment Infrastructure (Terraform)**
   - ✅ Converted to `for_each` pattern for multi-environment support
   - ✅ VPC with private/public subnets + 2 NAT gateways
   - ✅ Application Load Balancer with host-based routing
   - ✅ RDS PostgreSQL instance (shared between environments)
   - ✅ Route53 hosted zone with prod and dev DNS records
   - ✅ ACM certificate covering polemicyst.com, www.polemicyst.com, and dev.polemicyst.com
   - ✅ ECS cluster with separate services for prod and dev
   - ✅ ECR repositories for web, clip-worker, and llm-worker
   - ✅ S3 bucket with environment prefixes (prod/, dev/)

2. **Infrastructure Resources Deployed**
   - ALB: `polemicyst-alb-479641305.us-east-1.elb.amazonaws.com`
   - RDS: `polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com`
   - S3: `polemicyst-uploads-prod` (with `prod/` and `dev/` prefixes)
   - ECS Services:
     - **Production**: `polemicyst-prod-web`, `prod-clip-worker`, `prod-redis`, `prod-provocativeness-scorer`, `prod-comedic-scorer`
     - **Development**: `polemicyst-dev-web`, `dev-clip-worker`, `dev-redis`, `dev-provocativeness-scorer`, `dev-comedic-scorer`

3. **DNS Configuration**
   - ✅ Namecheap nameservers updated to Route53:
     - `ns-1305.awsdns-35.org`
     - `ns-1797.awsdns-32.co.uk`
     - `ns-273.awsdns-34.com`
     - `ns-772.awsdns-32.net`
   - ✅ A and AAAA records created for:
     - `polemicyst.com` → ALB
     - `www.polemicyst.com` → ALB
     - `dev.polemicyst.com` → ALB

4. **Application Code Updates**
   - ✅ S3 prefix utilities (`getS3Key`, `stripS3Prefix`) added to [shared/lib/s3.ts](../shared/lib/s3.ts)
   - ✅ All S3 operations updated to use environment-specific prefixes
   - ✅ Redis configuration updated for environment-aware service discovery
   - ✅ GitHub Actions workflow updated for branch-based deployment

5. **GitHub Actions**
   - ✅ Workflow configured for branch-based deployment:
     - `main` branch → production environment
     - `develop` branch → development environment
   - ✅ Secrets configured (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
   - ⏳ **In Progress**: Building and pushing dev environment images

### ⏳ In Progress

#### GitHub Actions Deployment

The develop branch has been pushed and GitHub Actions is currently:

1. Building Docker images with `:dev` tags
2. Pushing images to ECR
3. Deploying to dev ECS services

**Monitor progress**: https://github.com/austinconnor1836/polemicyst.com/actions

### ⚠️ Pending Actions

#### 1. Create Dev Database and Run Migrations

The `polemicyst_dev` database needs to be created in the shared RDS instance, and migrations need to be run for both environments.

**RDS is in private subnets** - requires VPC access. Options:

**Option A: Via ECS Exec (Recommended)**

```bash
# Wait for dev web service to be running
aws ecs list-tasks --cluster polemicyst-cluster --service-name polemicyst-dev-web

# Get task ID from output, then exec into container
aws ecs execute-command \
  --cluster polemicyst-cluster \
  --task TASK_ID \
  --container web \
  --command "/bin/sh" \
  --interactive

# Inside container, create database:
# Note: Container can connect to RDS via DATABASE_URL, but needs postgres db to create new db
# May need to install psql or use Node script

# Run migrations for dev
npx prisma migrate deploy
```

**Option B: Create Database via Node Script in ECS Task**

Create a migration task definition that:

1. Connects to RDS using postgres database
2. Creates `polemicyst_dev` database
3. Runs Prisma migrations

**Option C: AWS Session Manager Port Forwarding**

```bash
# Forward RDS port through SSM (requires bastion host or ECS Exec enabled)
aws ssm start-session --target <instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"portNumber":["5432"],"localPortNumber":["5432"],"host":["polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com"]}'

# In another terminal, create database and run migrations
PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -c "CREATE DATABASE polemicyst_dev"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polemicyst_dev npx prisma migrate deploy
```

**Production Database Migrations:**

```bash
# Also run on prod database if not already done
DATABASE_URL=postgresql://postgres:postgres@polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com:5432/clipsgenie npx prisma migrate deploy
```

#### 2. Verify Dev Environment

Once GitHub Actions completes and migrations are run:

**Check Deployment Status:**

```bash
# Check ECS services
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-dev-web dev-clip-worker dev-redis

# Check task health
aws ecs list-tasks --cluster polemicyst-cluster --service-name polemicyst-dev-web

# Check ALB target health
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:746669200861:targetgroup/polemicyst-dev-web-tg/983da4896b971916
```

**Test Dev Environment:**

1. Visit https://dev.polemicyst.com
2. Verify SSL certificate is valid
3. Test Google OAuth login
4. Upload a test video
5. Verify video is stored in S3 under `dev/` prefix
6. Check that dev and prod data are isolated

**Monitor Logs:**

```bash
# Dev web logs
aws logs tail /ecs/polemicyst-dev-web --follow

# Dev clip worker logs
aws logs tail /ecs/dev-clip-worker --follow

# Dev redis logs
aws logs tail /ecs/dev-redis --follow
```

#### 3. Verify Production Environment

After infrastructure changes, verify prod is still working:

**Check Production:**

```bash
# Check prod services
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-prod-web prod-clip-worker

# Check target health
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:746669200861:targetgroup/polemicyst-prod-web-tg/57360234aa9a09d2
```

**Test Production:**

1. Visit https://polemicyst.com
2. Verify no regressions
3. Test authentication
4. Verify existing videos still accessible
5. Verify S3 operations use `prod/` prefix

#### 4. Clean Up Old Resources

- **Old Target Group**: `polemicyst-web-tg` (ARN: `arn:aws:elasticloadbalancing:us-east-1:746669200861:targetgroup/polemicyst-web-tg/76f998095aa3ab25`)
  - No longer managed by Terraform (removed from state)
  - Can be manually deleted from AWS Console after confirming everything works
  - Located in EC2 → Target Groups

## Environment Configuration Summary

### Production Environment

- **Branch**: `main`
- **Domain**: `polemicyst.com`
- **Database**: `clipsgenie` (in shared RDS)
- **S3 Prefix**: `prod/`
- **Redis**: `redis-prod.polemicyst.local`
- **Resources**: 512 CPU, 1024 Memory
- **Services**:
  - `polemicyst-prod-web` (desired: 1)
  - `prod-clip-worker` (desired: 1)
  - `prod-redis` (desired: 1)
  - `prod-provocativeness-scorer` (desired: 0)
  - `prod-comedic-scorer` (desired: 0)

### Development Environment

- **Branch**: `develop`
- **Domain**: `dev.polemicyst.com`
- **Database**: `polemicyst_dev` (in shared RDS) - **NEEDS TO BE CREATED**
- **S3 Prefix**: `dev/`
- **Redis**: `redis-dev.polemicyst.local`
- **Resources**: 256 CPU, 512 Memory
- **Services**:
  - `polemicyst-dev-web` (desired: 1)
  - `dev-clip-worker` (desired: 0 - scale up when needed)
  - `dev-redis` (desired: 1)
  - `dev-provocativeness-scorer` (desired: 0)
  - `dev-comedic-scorer` (desired: 0)

## Cost Summary

### Current Monthly Costs (~$178/month)

- **Shared Infrastructure**: ~$109/month
  - VPC with 2 NAT Gateways: ~$65/month
  - RDS db.t3.small: ~$28/month
  - ALB: ~$16/month
- **Production Services**: ~$53/month
- **Development Services**: ~$16/month

### Cost Optimization Tips

1. **Scale dev to zero when not in use**:

   ```bash
   aws ecs update-service --cluster polemicyst-cluster --service polemicyst-dev-web --desired-count 0
   aws ecs update-service --cluster polemicyst-cluster --service dev-redis --desired-count 0
   ```

2. **Use auto-scaling schedules**:
   - Scale dev down at 6 PM weekdays
   - Scale dev down all weekend
   - Scale back up at 9 AM weekdays

3. **S3 lifecycle policies** for dev environment:
   - Delete objects older than 30 days
   - Move to Glacier after 7 days

## Deployment Workflow

### Making Changes

```bash
# For dev deployment
git checkout develop
git add .
git commit -m "Your changes"
git push origin develop  # Triggers dev deployment

# For prod deployment (after testing in dev)
git checkout main
git merge develop
git push origin main  # Triggers prod deployment
```

### Manual Service Updates

```bash
# Update web service
aws ecs update-service --cluster polemicyst-cluster --service polemicyst-prod-web --force-new-deployment

# Update clip worker
aws ecs update-service --cluster polemicyst-cluster --service prod-clip-worker --force-new-deployment

# Scale service
aws ecs update-service --cluster polemicyst-cluster --service dev-clip-worker --desired-count 1
```

## Important Files

- **Terraform Config**: `infrastructure/*.tf`
- **Terraform Variables**: `infrastructure/terraform.tfvars` (contains secrets, not in git)
- **GitHub Actions**: `.github/workflows/deploy.yml`
- **S3 Utilities**: `shared/lib/s3.ts`
- **Redis Config**: `shared/queues.ts`
- **Deployment Docs**: `docs/DEPLOYMENT.md`

## Quick Reference Commands

### View Infrastructure Outputs

```bash
cd infrastructure
terraform output
```

### Check Service Status

```bash
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-prod-web polemicyst-dev-web
```

### View Recent Logs

```bash
aws logs tail /ecs/polemicyst-prod-web --since 1h
aws logs tail /ecs/polemicyst-dev-web --since 1h
```

### Check Database Connections

```bash
# From within VPC (ECS Exec)
psql -h polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com -U postgres -l
```

### View ECR Images

```bash
aws ecr describe-images --repository-name polemicyst-web
aws ecr describe-images --repository-name polemicyst-clip-worker
```

## Troubleshooting

### Services Failing to Start

1. Check CloudWatch logs for errors
2. Verify environment variables in task definition
3. Check security group rules
4. Ensure database migrations have been run

### Database Connection Errors

1. Verify DATABASE_URL is correct in task definition
2. Check RDS security group allows ECS security group
3. Ensure database exists (especially `polemicyst_dev`)
4. Verify RDS is in available state

### S3 Upload/Access Issues

1. Check S3_BUCKET and S3_PREFIX environment variables
2. Verify ECS task role has S3 permissions
3. Ensure `getS3Key()` utility is used consistently
4. Check CloudWatch logs for S3 error messages

### DNS/SSL Issues

1. Verify DNS has propagated: `nslookup dev.polemicyst.com`
2. Check ACM certificate status in AWS Console
3. Verify Route53 records are correct
4. Check ALB listener certificate attachment

## Next Steps After Deployment

1. [ ] Create `polemicyst_dev` database in RDS
2. [ ] Run Prisma migrations on both databases
3. [ ] Monitor GitHub Actions deployment to completion
4. [ ] Test dev environment thoroughly
5. [ ] Verify prod environment still works
6. [ ] Delete old target group from AWS Console
7. [ ] Set up CloudWatch alarms for critical metrics
8. [ ] Configure auto-scaling schedules for dev
9. [ ] Set up S3 lifecycle policies for dev prefix
10. [ ] Document any environment-specific quirks

## Support & Resources

- **GitHub Repo**: https://github.com/austinconnor1836/polemicyst.com
- **GitHub Actions**: https://github.com/austinconnor1836/polemicyst.com/actions
- **AWS Console**: https://console.aws.amazon.com/
- **Terraform Docs**: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
