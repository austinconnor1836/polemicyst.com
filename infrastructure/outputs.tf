output "ecr_repository_url" {
  value = aws_ecr_repository.llm_worker.repository_url
}

output "clip_worker_repository_url" {
  value = aws_ecr_repository.clip_worker.repository_url
}

output "web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  value = aws_lb.web.dns_name
}

output "route53_name_servers" {
  value = aws_route53_zone.primary.name_servers
}

output "rds_endpoint" {
  description = "Prod RDS endpoint (legacy)"
  value       = aws_db_instance.db["prod"].address
}

output "rds_endpoints" {
  description = "RDS endpoint per environment"
  value       = { for env, db in aws_db_instance.db : env => db.address }
}

output "s3_bucket" {
  value = aws_s3_bucket.media.bucket
}
