resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "polemicyst.local"
  description = "Private DNS namespace for service discovery"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "redis" {
  name = "redis"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "redis" {
  family                   = "${var.app_name}-redis"
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
          "awslogs-group"         = "/ecs/${var.app_name}-redis"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "redis" {
  name            = "redis"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.redis.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.redis.arn
  }
}

# Provocativeness Scorer
resource "aws_ecs_task_definition" "provocativeness" {
  family                   = "${var.app_name}-provocativeness"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024" # Needs more CPU for Ollama
  memory                   = "4096" # Needs more RAM for Ollama
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.llm_worker.repository_url}:latest"
      environment = [
        { name = "REDIS_HOST", value = "redis.polemicyst.local" },
        { name = "SCORING_TYPE", value = "PROVOCATIVENESS" },
        { name = "OLLAMA_HOST", value = "http://localhost:11434" }
      ]
      dependsOn = [{
        containerName = "ollama"
        condition     = "START"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-provocativeness"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
    },
    {
      name  = "ollama"
      image = "ollama/ollama:latest"
      cpu   = 512
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
          "awslogs-group"         = "/ecs/${var.app_name}-provocativeness"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ollama"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "provocativeness" {
  name            = "provocativeness-scorer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.provocativeness.arn
  desired_count   = 0 # Scale to zero initially


  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }
}

# Comedic Scorer
resource "aws_ecs_task_definition" "comedic" {
  family                   = "${var.app_name}-comedic"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.llm_worker.repository_url}:latest"
      environment = [
        { name = "REDIS_HOST", value = "redis.polemicyst.local" },
        { name = "SCORING_TYPE", value = "COMEDIC" },
        { name = "OLLAMA_HOST", value = "http://localhost:11434" }
      ]
      dependsOn = [{
        containerName = "ollama"
        condition     = "START"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-comedic"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
    },
    {
      name  = "ollama"
      image = "ollama/ollama:latest"
      cpu   = 512
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
          "awslogs-group"         = "/ecs/${var.app_name}-comedic"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ollama"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "comedic" {
  name            = "comedic-scorer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.comedic.arn
  desired_count   = 0


  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }
}

# Clip Worker
resource "aws_ecs_task_definition" "clip_worker" {
  family                   = "${var.app_name}-clip-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "clip-worker"
      image = "${aws_ecr_repository.clip_worker.repository_url}:latest"
      environment = [
        { name = "REDIS_HOST", value = "redis.polemicyst.local" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-clip-worker"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
          "awslogs-create-group"  = "true"
        }
      }
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
    }
  ])
}

resource "aws_ecs_service" "clip_worker" {
  name            = "clip-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.clip_worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.clip_worker.arn
    container_name   = "clip-worker"
    container_port   = 3001
  }
}
