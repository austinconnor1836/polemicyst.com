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
  description = "Environment (dev, prod)"
  type        = string
  default     = "dev"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "polemicyst.com"
}
