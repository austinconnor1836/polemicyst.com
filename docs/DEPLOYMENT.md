# Production Deployment (AWS + Terraform)

This repo deploys the Next.js app and workers to AWS ECS with multi-environment support (prod/dev), using Route53 + ACM + ALB + RDS.

All Terraform configuration lives in `infrastructure/`.

## Architecture Overview

### Multi-Environment Strategy

The infrastructure supports both **production** and **development** environments using a cost-effective shared infrastructure approach:

**Shared Infrastructure** (between prod and dev):

- VPC, NAT Gateways, Internet Gateway
- Single RDS instance (with separate databases)
- Single S3 bucket (with environment prefixes: `prod/`, `dev/`)
- Single Application Load Balancer (with host-based routing)
- Single ECS cluster

**Separate Per Environment**:

- ECS services and task definitions
- ALB target groups and listener rules
- Database schemas within RDS
- S3 object prefixes
- Redis instances
- DNS records

**Cost Impact**: ~$16/month increase for dev environment (vs ~$160/month for full duplicate infrastructure)

### Environment Routing

- **Production**: `main` branch → `polemicyst.com`
- **Development**: `develop` branch → `dev.polemicyst.com`

Host-based ALB routing directs traffic to the appropriate target group based on the domain.

## 1) Terraform Variables

Create `infrastructure/terraform.tfvars` with the following multi-environment configuration:

```hcl
# Shared configuration
domain_name = "polemicyst.com"

s3_bucket = "polemicyst-uploads-prod"
s3_region = "us-east-1"

# Database configuration (shared RDS instance)
db_username       = "postgres"
db_password       = "YOUR_SECURE_PASSWORD"
db_engine_version = "17.6"

# Recommended for prod:
db_skip_final_snapshot = false
db_deletion_protection = true

# Shared authentication configuration
google_client_id       = "YOUR_GOOGLE_CLIENT_ID"
google_client_secret   = "YOUR_GOOGLE_CLIENT_SECRET"
auth_allowlist_enabled = "true"
auth_allowed_emails    = "your-email@example.com"
auth_allowed_providers = "google"

# Multi-environment configuration
environments = {
  prod = {
    # ECS configuration
    web_desired_count         = 1
    web_cpu                   = "512"
    web_memory                = "1024"
    clip_worker_desired_count = 1

    # Database (schema name in shared RDS instance)
    db_name = "clipsgenie"

    # Domain
    domain = "polemicyst.com"

    # NextAuth
    nextauth_url    = "https://polemicyst.com"
    nextauth_secret = "YOUR_PROD_NEXTAUTH_SECRET"

    # S3 prefix for object separation
    s3_prefix = "prod"
  }

  dev = {
    # ECS configuration (smaller resources for dev)
    web_desired_count         = 1
    web_cpu                   = "256"
    web_memory                = "512"
    clip_worker_desired_count = 0  # Scale to 0 by default, scale up when needed

    # Database (schema name in shared RDS instance)
    db_name = "polemicyst_dev"

    # Domain
    domain = "dev.polemicyst.com"

    # NextAuth
    nextauth_url    = "https://dev.polemicyst.com"
    nextauth_secret = "YOUR_DEV_NEXTAUTH_SECRET"

    # S3 prefix for object separation
    s3_prefix = "dev"
  }
}
```

### Important Notes:

- **S3 Prefixes**: Both environments use the same S3 bucket but different prefixes (`prod/`, `dev/`) for object isolation
- **Databases**: Both environments use the same RDS instance but different database schemas (`clipsgenie`, `polemicyst_dev`)
- **Redis**: Separate Redis instances per environment with service discovery (`redis-prod.polemicyst.local`, `redis-dev.polemicyst.local`)
- **NextAuth Secrets**: Use different secrets for prod and dev (generate with `openssl rand -base64 32`)

## 2) Apply Terraform

From repo root:

```bash
cd infrastructure
terraform init
terraform apply
```

Useful outputs:

- `route53_name_servers` (for DNS configuration)
- `alb_dns_name` (ALB endpoint)
- `rds_endpoint` (database endpoint)
- `s3_bucket` (shared S3 bucket)
- `vpc_id` (VPC identifier)

## 3) Point DNS to Route53

After `terraform apply`, copy Route53 name servers:

```bash
terraform output route53_name_servers
```

Then in your DNS provider (Namecheap):

1. Domain List → Manage → Nameservers
2. Choose "Custom DNS"
3. Paste the 4 AWS nameservers
4. Save (DNS propagation can take a few hours)

Route53 will handle both `polemicyst.com` and `dev.polemicyst.com` subdomains.

## 4) GitHub Actions Secrets

Add these GitHub Actions secrets in your repository settings:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

The workflow in `.github/workflows/deploy.yml` automatically:

1. Detects branch (main = prod, develop = dev)
2. Builds Docker images with environment-specific tags (`:prod`, `:dev`)
3. Pushes to ECR
4. Updates ECS services for the appropriate environment

## 5) Database Setup

After RDS is up, create the databases and run migrations:

### Create Dev Database

```bash
# Connect to RDS (from within VPC or via bastion)
psql -h YOUR_RDS_ENDPOINT -U postgres -d postgres

# Create dev database
CREATE DATABASE polemicyst_dev;
GRANT ALL PRIVILEGES ON DATABASE polemicyst_dev TO postgres;
\q
```

### Run Migrations

For **production** database:

```bash
DATABASE_URL=postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/clipsgenie npx prisma migrate deploy
```

For **development** database:

```bash
DATABASE_URL=postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/polemicyst_dev npx prisma migrate deploy
```

**Note**: RDS is in a private subnet. Run migrations either:

- From a bastion host in the VPC
- Via ECS Exec into a running web container
- Using a one-off ECS task

### Running Migrations via ECS Exec

```bash
# List running tasks
aws ecs list-tasks --cluster polemicyst-cluster --service-name polemicyst-dev-web

# Execute into container
aws ecs execute-command \
  --cluster polemicyst-cluster \
  --task TASK_ID \
  --container web \
  --command "/bin/sh" \
  --interactive

# Inside container:
npx prisma migrate deploy
```

## 6) Verify Deployments

### Production Environment

- Open `https://polemicyst.com` once DNS + ACM validation are complete
- Verify ECS services are healthy: `polemicyst-prod-web`, `prod-clip-worker`, etc.
- Test Google OAuth login
- Upload a test video and verify it's stored under `prod/` prefix in S3

### Development Environment

- Open `https://dev.polemicyst.com`
- Verify SSL certificate is valid for subdomain
- Test authentication flow
- Upload a test video and verify it's stored under `dev/` prefix in S3
- Check that dev and prod data are isolated

### Monitoring

```bash
# Check ECS service status
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-prod-web polemicyst-dev-web

# Check task health
aws ecs list-tasks --cluster polemicyst-cluster --desired-status RUNNING

# View logs
aws logs tail /ecs/polemicyst-prod-web --follow
aws logs tail /ecs/polemicyst-dev-web --follow
```

## Environment-Specific Configuration

Each environment has its own configuration injected via ECS task definitions:

| Variable       | Production                    | Development                  |
| -------------- | ----------------------------- | ---------------------------- |
| `ENVIRONMENT`  | `prod`                        | `dev`                        |
| `DATABASE_URL` | Points to `clipsgenie`        | Points to `polemicyst_dev`   |
| `NEXTAUTH_URL` | `https://polemicyst.com`      | `https://dev.polemicyst.com` |
| `S3_PREFIX`    | `prod`                        | `dev`                        |
| `REDIS_HOST`   | `redis-prod.polemicyst.local` | `redis-dev.polemicyst.local` |
| `NODE_ENV`     | `production`                  | `development`                |
| CPU/Memory     | 512/1024                      | 256/512                      |

## Deployment Workflow

### Deploying to Development

```bash
git checkout develop
git add .
git commit -m "Your changes"
git push origin develop
```

GitHub Actions automatically builds and deploys to dev environment.

### Deploying to Production

```bash
git checkout main
git merge develop
git push origin main
```

GitHub Actions automatically builds and deploys to prod environment.

## Cost Optimization

### Current Monthly Costs (~$178/month)

- VPC with NAT Gateways: ~$65/month
- RDS db.t3.small: ~$28/month
- ALB: ~$16/month
- ECS prod services: ~$53/month
- ECS dev services: ~$16/month

### Tips to Reduce Dev Costs

1. **Scale dev to zero when not in use**:

   ```bash
   aws ecs update-service --cluster polemicyst-cluster --service polemicyst-dev-web --desired-count 0
   aws ecs update-service --cluster polemicyst-cluster --service dev-clip-worker --desired-count 0
   ```

2. **Auto-scaling schedule**: Set up CloudWatch Events to scale dev services:
   - Scale to 0 at 6 PM weekdays
   - Scale to 0 all weekend
   - Scale back up at 9 AM weekdays

3. **S3 Lifecycle Policies**: Archive or delete old dev objects:
   ```bash
   aws s3api put-bucket-lifecycle-configuration --bucket polemicyst-uploads-prod \
     --lifecycle-configuration file://lifecycle-policy.json
   ```

## Troubleshooting

### Services Not Starting

- Check ECS task logs in CloudWatch
- Verify environment variables are set correctly
- Ensure security groups allow traffic between ALB and ECS tasks

### Database Connection Issues

- Verify RDS security group allows connections from ECS security group
- Check DATABASE_URL format: `postgresql://USER:PASS@HOST:5432/DBNAME`
- Ensure database exists and migrations have been run

### S3 Access Issues

- Verify ECS task role has S3 permissions
- Check S3_BUCKET and S3_PREFIX environment variables
- Ensure getS3Key() utility is used for all S3 operations

### SSL Certificate Issues

- ACM validation can take 20-30 minutes
- Verify DNS CNAME records for validation are present in Route53
- Check certificate status in ACM console

## Maintenance Checklist

When returning to this project:

- [ ] Confirm DNS is pointing to Route53 nameservers
- [ ] Check ECS services are running in both environments
- [ ] Verify GitHub Actions secrets are set and builds are passing
- [ ] Review `terraform plan` for any drift before applying changes
- [ ] Check CloudWatch logs for any errors or warnings
- [ ] Verify SSL certificates are valid and auto-renewing
- [ ] Review AWS costs in Cost Explorer
- [ ] Ensure both prod and dev databases have recent backups
- [ ] Test both environments end-to-end

## Rollback Procedure

If a deployment causes issues:

1. **Quick rollback** via ECS:

   ```bash
   # Revert to previous task definition
   aws ecs update-service --cluster polemicyst-cluster \
     --service polemicyst-prod-web \
     --task-definition polemicyst-prod-web:PREVIOUS_REVISION
   ```

2. **Git revert and redeploy**:

   ```bash
   git revert HEAD
   git push origin main
   # Wait for GitHub Actions to deploy
   ```

3. **Infrastructure rollback**:
   ```bash
   cd infrastructure
   git checkout PREVIOUS_COMMIT -- .
   terraform plan
   terraform apply
   ```

## Additional Resources

- [Terraform AWS ECS Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service)
- [Next.js Deployment Documentation](https://nextjs.org/docs/deployment)
- [Prisma Migration Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
