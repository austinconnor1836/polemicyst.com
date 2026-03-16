resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "polemicyst.local"
  description = "Private DNS namespace for service discovery"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "redis" {
  for_each = local.environments

  name = "redis-${each.key}"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  tags = {
    Name        = "redis-${each.key}"
    Environment = each.key
  }
}

resource "aws_ecs_task_definition" "redis" {
  for_each = local.environments

  family                   = "${var.app_name}-${each.key}-redis"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name  = "redis"
      image = "redis:alpine"
      portMappings = [
        {
          containerPort = 6379
          hostPort      = 6379
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-redis"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name        = "${var.app_name}-${each.key}-redis"
    Environment = each.key
  }
}

resource "aws_ecs_service" "redis" {
  for_each = local.environments

  name            = "${each.key}-redis"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.redis[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.redis[each.key].arn
  }

  tags = {
    Name        = "${each.key}-redis"
    Environment = each.key
  }
}

# Provocativeness Scorer
resource "aws_ecs_task_definition" "provocativeness" {
  for_each = local.environments

  family                   = "${var.app_name}-${each.key}-provocativeness"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024" # Needs more CPU for Ollama
  memory                   = "4096" # Needs more RAM for Ollama
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.llm_worker.repository_url}:${each.key}"
      environment = [
        { name = "REDIS_HOST", value = "redis-${each.key}.${var.app_name}.local" },
        { name = "SCORING_TYPE", value = "PROVOCATIVENESS" },
        { name = "OLLAMA_HOST", value = "http://localhost:11434" },
        { name = "DATABASE_URL", value = each.value.database_url },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_REGION", value = local.s3_region },
        { name = "S3_BUCKET", value = var.s3_bucket },
        { name = "S3_PREFIX", value = each.value.web_environment.S3_PREFIX },
        { name = "ENVIRONMENT", value = each.key }
      ]
      dependsOn = [{
        containerName = "ollama"
        condition     = "START"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-provocativeness"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
    },
    {
      name   = "ollama"
      image  = "ollama/ollama:latest"
      cpu    = 512
      memory = 2048
      portMappings = [
        {
          containerPort = 11434
          hostPort      = 11434
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-provocativeness"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ollama"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name        = "${var.app_name}-${each.key}-provocativeness"
    Environment = each.key
  }
}

resource "aws_ecs_service" "provocativeness" {
  for_each = local.environments

  name            = "${each.key}-provocativeness-scorer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.provocativeness[each.key].arn
  desired_count   = 0 # Scale to zero initially

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  tags = {
    Name        = "${each.key}-provocativeness-scorer"
    Environment = each.key
  }
}

# Comedic Scorer
resource "aws_ecs_task_definition" "comedic" {
  for_each = local.environments

  family                   = "${var.app_name}-${each.key}-comedic"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.llm_worker.repository_url}:${each.key}"
      environment = [
        { name = "REDIS_HOST", value = "redis-${each.key}.${var.app_name}.local" },
        { name = "SCORING_TYPE", value = "COMEDIC" },
        { name = "OLLAMA_HOST", value = "http://localhost:11434" },
        { name = "DATABASE_URL", value = each.value.database_url },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_REGION", value = local.s3_region },
        { name = "S3_BUCKET", value = var.s3_bucket },
        { name = "S3_PREFIX", value = each.value.web_environment.S3_PREFIX },
        { name = "ENVIRONMENT", value = each.key }
      ]
      dependsOn = [{
        containerName = "ollama"
        condition     = "START"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-comedic"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
    },
    {
      name   = "ollama"
      image  = "ollama/ollama:latest"
      cpu    = 512
      memory = 2048
      portMappings = [
        {
          containerPort = 11434
          hostPort      = 11434
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-comedic"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ollama"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name        = "${var.app_name}-${each.key}-comedic"
    Environment = each.key
  }
}

resource "aws_ecs_service" "comedic" {
  for_each = local.environments

  name            = "${each.key}-comedic-scorer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.comedic[each.key].arn
  desired_count   = 0

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  tags = {
    Name        = "${each.key}-comedic-scorer"
    Environment = each.key
  }
}

# Clip Worker
resource "aws_ecs_task_definition" "clip_worker" {
  for_each = local.environments

  family                   = "${var.app_name}-${each.key}-clip-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "clip-worker"
      image = "${aws_ecr_repository.clip_worker.repository_url}:${each.key}"
      environment = [
        for key, value in each.value.clip_worker_environment : {
          name  = key
          value = tostring(value)
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-clip-worker"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name        = "${var.app_name}-${each.key}-clip-worker"
    Environment = each.key
  }
}

resource "aws_ecs_service" "clip_worker" {
  for_each = local.environments

  name            = "${each.key}-clip-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.clip_worker[each.key].arn
  desired_count   = each.value.clip_worker_desired_count

  # Use Fargate Spot for cost savings (~70% cheaper).
  # Clip jobs are idempotent and retried via BullMQ, so Spot interruptions are safe.
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  # Stop restarting after consecutive failures — prevents crash-loop cost spikes.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  tags = {
    Name        = "${each.key}-clip-worker"
    Environment = each.key
  }
}
