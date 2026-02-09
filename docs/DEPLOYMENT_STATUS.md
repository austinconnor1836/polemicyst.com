# Deployment Status & Next Steps

**Last Updated:** 2026-02-09

## Current Status

### ✅ Completed

1. **Infrastructure (Terraform)**
   - VPC with private subnets + NAT gateway created
   - ALB created: `polemicyst-alb-479641305.us-east-1.elb.amazonaws.com`
   - RDS PostgreSQL created: `polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com`
   - Route53 hosted zone configured
   - ACM certificate created
   - ECS cluster and services defined
   - ECR repositories created

2. **DNS Configuration**
   - Namecheap nameservers updated to Route53:
     - `ns-1305.awsdns-35.org`
     - `ns-1797.awsdns-32.co.uk`
     - `ns-273.awsdns-34.com`
     - `ns-772.awsdns-32.net`

3. **Docker Images**
   - Web app image built and pushed to ECR (Jan 30)
   - Clip worker image built and pushed to ECR (Jan 30)
   - LLM worker repository created

4. **Configuration Fixes**
   - S3 region corrected in `infrastructure/terraform.tfvars` (us-east-2 → us-east-1)
   - Video preload changed to `"none"` to reduce S3 costs

### ⚠️ Pending Actions

#### 1. Apply Terraform Changes

The S3_REGION fix in `terraform.tfvars` needs to be applied to update ECS task environment variables.

**Options:**

**A) Install Terraform locally** (Recommended for full control)
```bash
# Windows (via Chocolatey)
choco install terraform

# Or download from: https://www.terraform.io/downloads

# Then apply:
cd infrastructure
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

**B) Use Terraform Cloud/CI-CD**
- Set up Terraform Cloud workspace
- Configure remote backend in `infrastructure/backend.tf`
- Trigger apply via CI/CD

**C) Use Docker (if Terraform not installed)**
```powershell
cd infrastructure
docker run --rm -v ${PWD}:/workspace -w /workspace hashicorp/terraform:latest init
docker run --rm -v ${PWD}:/workspace -w /workspace hashicorp/terraform:latest apply -var-file=terraform.tfvars -auto-approve
```

#### 2. Run Database Migrations

RDS is in private subnets (secure by design) and can't be accessed from local machine.

**Options:**

**A) Run migrations from ECS task** (Recommended)
```bash
# Create one-time ECS task to run migrations
aws ecs run-task \
  --cluster polemicyst-cluster \
  --task-definition polemicyst-web \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"web","command":["npx","prisma","migrate","deploy"]}]}'
```

**B) Use AWS Session Manager** (Port forwarding)
```bash
# 1. Create bastion host or use existing ECS task
# 2. Forward RDS port through Session Manager
aws ssm start-session --target <instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"portNumber":["5432"],"localPortNumber":["5432"],"host":["polemicyst-prod-db.cuxmuuo4s1vd.us-east-1.rds.amazonaws.com"]}'

# 3. Then run migrations locally
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clipsgenie npx prisma migrate deploy
```

**C) Update security group temporarily** (Not recommended for production)
```bash
# Allow your IP temporarily
aws ec2 authorize-security-group-ingress \
  --group-id <rds-security-group-id> \
  --protocol tcp \
  --port 5432 \
  --cidr <your-ip>/32

# Run migrations, then revoke access
aws ec2 revoke-security-group-ingress \
  --group-id <rds-security-group-id> \
  --protocol tcp \
  --port 5432 \
  --cidr <your-ip>/32
```

#### 3. Verify Deployment

Once migrations are complete:

1. **Check ECS services are healthy:**
   ```bash
   aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-web clip-worker redis
   ```

2. **Check ALB target health:**
   ```bash
   aws elbv2 describe-target-health --target-group-arn <target-group-arn>
   ```

3. **Test the website:**
   - Visit: https://polemicyst.com
   - Check login works (Google OAuth)
   - Upload a test video
   - Verify workers process it

4. **Monitor logs:**
   ```bash
   # Web app logs
   aws logs tail /ecs/polemicyst-web --follow

   # Clip worker logs
   aws logs tail /ecs/polemicyst-clip-worker --follow
   ```

## Important Notes

### S3 Bucket Configuration

- **Dev:** Create separate bucket `polemicyst-uploads-dev` in `us-east-1`
- **Prod:** Currently using `polemicyst-uploads-prod` in `us-east-1`
- Old S3 URLs in the database still point to `us-east-2` - you may want to migrate or start with fresh data

### Environment Variables

Key env vars for production (already set in `terraform.tfvars`):

```hcl
web_environment = {
  NEXTAUTH_URL           = "https://polemicyst.com"
  NEXTAUTH_SECRET        = "..." # Secure secret
  GOOGLE_CLIENT_ID       = "..."
  GOOGLE_CLIENT_SECRET   = "..."
  AUTH_ALLOWLIST_ENABLED = "true"
  AUTH_ALLOWED_EMAILS    = "aconnor731@gmail.com"
  AUTH_ALLOWED_PROVIDERS = "google"
}
```

Also auto-injected by Terraform:
- `S3_BUCKET=polemicyst-uploads-prod`
- `S3_REGION=us-east-1`
- `DATABASE_URL=postgresql://...` (constructed from RDS endpoint)

### GitHub Actions

`.github/workflows/deploy.yml` is configured to:
1. Build and push Docker images on push to `main` or `develop`
2. Force new ECS deployments

**Required GitHub Secrets:**
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Check if these are set: https://github.com/YOUR_USERNAME/polemicyst.com/settings/secrets/actions

### Cost Optimization

1. **Video preload:** Changed to `"none"` to reduce S3 GET requests
2. **LLM workers:** Scaled to 0 by default (scale up when needed)
3. **FARGATE_SPOT:** Used for LLM workers to reduce costs
4. **Consider CloudFront:** Add CDN in front of S3 for better caching

## Quick Commands

### Check Terraform State
```bash
cd infrastructure
terraform output  # View all outputs
terraform state list  # List all resources
```

### Update a Single Service
```bash
aws ecs update-service --cluster polemicyst-cluster --service polemicyst-web --force-new-deployment
```

### Scale Services
```bash
# Scale down provocativeness scorer
aws ecs update-service --cluster polemicyst-cluster --service provocativeness-scorer --desired-count 0

# Scale up for processing
aws ecs update-service --cluster polemicyst-cluster --service provocativeness-scorer --desired-count 1
```

### View ECR Images
```bash
aws ecr describe-images --repository-name polemicyst-web --max-items 5
aws ecr describe-images --repository-name polemicyst-clip-worker --max-items 5
aws ecr describe-images --repository-name polemicyst-llm-worker --max-items 5
```

## Troubleshooting

### Site not loading
1. Check DNS propagation: `nslookup polemicyst.com`
2. Check ACM certificate validation in AWS Console
3. Check ALB target health
4. Check ECS task logs

### Database connection errors
1. Verify `DATABASE_URL` env var in ECS task definition
2. Check RDS security group allows traffic from ECS security group
3. Check RDS is in same VPC as ECS tasks

### S3 upload/access errors
1. Verify `S3_BUCKET` and `S3_REGION` env vars are set correctly
2. Check ECS task IAM role has S3 permissions
3. Verify bucket policy allows ECS task role

### Workers not processing
1. Check Redis service is running
2. Verify worker task environment variables
3. Check worker logs for errors
4. Ensure queue names match between API and workers
