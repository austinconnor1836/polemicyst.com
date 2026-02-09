variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "polemicyst"
}

variable "environment" {
  description = "Legacy environment variable (kept for backward compatibility with RDS identifier)"
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "polemicyst.com"
}

variable "db_name" {
  description = "Initial database name for RDS instance (shared across environments)"
  type        = string
  default     = "clipsgenie"
}

variable "db_username" {
  description = "Database username"
  type        = string
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "db_engine_version" {
  description = "Postgres engine version"
  type        = string
  default     = "15.5"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.small"
}

variable "db_allocated_storage" {
  description = "Allocated storage (GB)"
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Enable Multi-AZ"
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Backup retention in days"
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = false
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot on destroy"
  type        = bool
  default     = true
}

variable "web_cpu" {
  description = "CPU units for the web task"
  type        = string
  default     = "512"
}

variable "web_memory" {
  description = "Memory (MB) for the web task"
  type        = string
  default     = "1024"
}

variable "web_desired_count" {
  description = "Desired task count for the web service"
  type        = number
  default     = 1
}

variable "web_environment" {
  description = "Additional environment variables for the web container"
  type        = map(string)
  default     = {}
}

variable "s3_bucket" {
  description = "S3 bucket for uploads/clips (per environment)"
  type        = string
}

variable "s3_region" {
  description = "S3 region (defaults to aws_region if empty)"
  type        = string
  default     = ""
}

variable "s3_force_destroy" {
  description = "Allow Terraform to delete S3 bucket with objects (dev only)"
  type        = bool
  default     = false
}

# Multi-environment configuration
variable "environments" {
  description = "Map of environments to deploy"
  type = map(object({
    web_desired_count         = number
    web_cpu                   = string
    web_memory                = string
    clip_worker_desired_count = number
    db_name                   = string
    domain                    = string
    nextauth_url              = string
    nextauth_secret           = string
    s3_prefix                 = string
  }))
  default = {}
}

# Shared authentication configuration
variable "google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "auth_allowlist_enabled" {
  description = "Enable email allowlist"
  type        = string
  default     = "false"
}

variable "auth_allowed_emails" {
  description = "Comma-separated list of allowed emails"
  type        = string
  default     = ""
}

variable "auth_allowed_providers" {
  description = "Comma-separated list of allowed auth providers"
  type        = string
  default     = "google"
}
