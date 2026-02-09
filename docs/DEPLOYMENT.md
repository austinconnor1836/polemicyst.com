# Production deployment (AWS + Terraform)

This repo deploys the Next.js app and workers to AWS ECS, with Route53 + ACM + ALB + RDS.
All Terraform lives in `infrastructure/`.

## 1) Terraform variables

Create `infrastructure/terraform.tfvars`:

```hcl
environment = "prod"
domain_name = "polemicyst.com"

s3_bucket = "polemicyst-uploads-prod"
s3_region = "us-east-1"

db_name     = "polemicyst"
db_username = "YOUR_DB_USER"
db_password = "YOUR_DB_PASSWORD"

# Recommended for prod:
db_skip_final_snapshot = false
db_deletion_protection = true

web_environment = {
  NEXTAUTH_URL            = "https://polemicyst.com"
  NEXTAUTH_SECRET         = "YOUR_NEXTAUTH_SECRET"
  GOOGLE_CLIENT_ID        = "YOUR_GOOGLE_CLIENT_ID"
  GOOGLE_CLIENT_SECRET    = "YOUR_GOOGLE_CLIENT_SECRET"
  AUTH_ALLOWLIST_ENABLED  = "true"
  AUTH_ALLOWED_EMAILS     = "your-google-email@example.com"
  AUTH_ALLOWED_PROVIDERS  = "google"
}
```

Notes:
- `s3_bucket`/`s3_region` are injected into the web and worker tasks as `S3_BUCKET`/`S3_REGION`.
- `S3_BUCKET` and `S3_REGION` must be set per environment.
- For dev/prod separation, use separate buckets.
  - Example dev tfvars: `environment = "dev"` and `s3_bucket = "polemicyst-uploads-dev"`

## 2) Apply Terraform

From repo root:

```bash
cd infrastructure
terraform init
terraform apply
```

Useful outputs:
- `route53_name_servers` (for Namecheap)
- `alb_dns_name`
- `rds_endpoint`

## 3) Point Namecheap DNS to Route53

After `terraform apply`, copy Route53 name servers:

```bash
terraform output route53_name_servers
```

Then in Namecheap:
1) Domain List -> Manage -> Nameservers
2) Choose "Custom DNS"
3) Paste the 4 AWS nameservers
4) Save (DNS propagation can take a few hours)

## 4) GitHub Actions secrets

Add these GitHub Actions secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

The workflow in `.github/workflows/deploy.yml` builds/pushes:
- Web app (`Dockerfile`, repo root)
- Workers (`workers/*/Dockerfile`)

Then it forces new ECS deployments.

## 5) Database migrations

After RDS is up, run Prisma migrations against it:

```bash
# Example (run locally with DATABASE_URL pointing at RDS)
npx prisma migrate deploy
```

## 6) Verify

- Open `https://polemicyst.com` once DNS + ACM validation are complete.
- Verify ECS services are healthy in AWS console.

## Returning checklist

When you come back to this later:
- Confirm Namecheap is using the Route53 nameservers (`terraform output route53_name_servers`).
- Check ECS services are running (`polemicyst-web`, `clip-worker`, `provocativeness-scorer`, `comedic-scorer`).
- Ensure GitHub Actions secrets are set and the `develop`/`main` build is passing.
- Validate `S3_BUCKET`/`S3_REGION` and `DATABASE_URL` in `terraform.tfvars`.
- Re-run `terraform plan` to review any drift before changes.

## S3 cost control

Why you might see S3 GETs:
- Any `<video src="...">` will trigger network calls for metadata or playback.
- Old `s3Url` values in the DB will still point to old buckets/regions.

Recommended:
- Set `S3_BUCKET`/`S3_REGION` for prod.
- Start prod with a clean DB or update old rows to the new bucket.
- Consider CloudFront in front of S3 later if bandwidth cost becomes an issue.

