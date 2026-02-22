locals {
  # Legacy single-environment support (fallback)
  database_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${var.db_name}"
  s3_region    = var.s3_region != "" ? var.s3_region : var.aws_region

  # Multi-environment configuration
  environments = {
    for env_name, env_config in var.environments : env_name => {
      # Database URL for this environment
      database_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${env_config.db_name}"

      # Web service environment variables
      web_environment = {
        # AWS Configuration
        AWS_REGION = var.aws_region
        S3_REGION  = local.s3_region
        S3_BUCKET  = var.s3_bucket
        S3_PREFIX  = env_config.s3_prefix

        # Environment
        ENVIRONMENT = env_name
        NODE_ENV    = env_name == "prod" ? "production" : "development"

        # Database
        DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${env_config.db_name}"

        # NextAuth
        NEXTAUTH_URL    = env_config.nextauth_url
        NEXTAUTH_SECRET = env_config.nextauth_secret

        # Google OAuth (shared across environments)
        GOOGLE_CLIENT_ID     = var.google_client_id
        GOOGLE_CLIENT_SECRET = var.google_client_secret

        # Auth allowlist (shared across environments)
        AUTH_ALLOWLIST_ENABLED = var.auth_allowlist_enabled
        AUTH_ALLOWED_EMAILS    = var.auth_allowed_emails
        AUTH_ALLOWED_PROVIDERS = var.auth_allowed_providers

        # Redis (environment-specific service discovery)
        REDIS_HOST = "redis-${env_name}.${var.app_name}.local"
      }

      # Clip worker environment variables
      clip_worker_environment = {
        # AWS Configuration
        AWS_REGION = var.aws_region
        S3_REGION  = local.s3_region
        S3_BUCKET  = var.s3_bucket
        S3_PREFIX  = env_config.s3_prefix

        # Environment
        ENVIRONMENT = env_name
        NODE_ENV    = env_name == "prod" ? "production" : "development"

        # Database
        DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${env_config.db_name}"

        # Redis
        REDIS_HOST = "redis-${env_name}.${var.app_name}.local"
      }

      # ECS configuration
      web_cpu                   = env_config.web_cpu
      web_memory                = env_config.web_memory
      web_desired_count         = env_config.web_desired_count
      clip_worker_desired_count = env_config.clip_worker_desired_count

      # Domain configuration
      domain = env_config.domain
    }
  }

  # Legacy web_environment for backward compatibility
  web_environment = merge(
    {
      AWS_REGION   = var.aws_region
      S3_REGION    = local.s3_region
      S3_BUCKET    = var.s3_bucket
      NODE_ENV     = "production"
      DATABASE_URL = local.database_url
    },
    var.web_environment
  )
}
