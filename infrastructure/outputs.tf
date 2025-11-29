output "ecr_repository_url" {
  value = aws_ecr_repository.llm_worker.repository_url
}

output "clip_worker_repository_url" {
  value = aws_ecr_repository.clip_worker.repository_url
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}
