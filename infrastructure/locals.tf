locals {
  database_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${var.db_name}"
  s3_region    = var.s3_region != "" ? var.s3_region : var.aws_region
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
