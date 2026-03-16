resource "aws_ecs_task_definition" "web" {
  for_each = local.environments

  family                   = "${var.app_name}-${each.key}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = each.value.web_cpu
  memory                   = each.value.web_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "web"
      image = "${aws_ecr_repository.web.repository_url}:${each.key}"
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
      environment = [
        for key, value in each.value.web_environment : {
          name  = key
          value = tostring(value)
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.app_name}-${each.key}-web"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name        = "${var.app_name}-${each.key}-web"
    Environment = each.key
  }
}

resource "aws_ecs_service" "web" {
  for_each = local.environments

  name                              = "${var.app_name}-${each.key}-web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.web[each.key].arn
  desired_count                     = each.value.web_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

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

  load_balancer {
    target_group_arn = aws_lb_target_group.web[each.key].arn
    container_name   = "web"
    container_port   = 3000
  }

  tags = {
    Name        = "${var.app_name}-${each.key}-web"
    Environment = each.key
  }

  depends_on = [aws_lb_listener.https]
}
