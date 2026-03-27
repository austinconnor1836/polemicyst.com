# =============================================================================
# ECS Auto Scaling — Web Service + Clip Worker
# =============================================================================

# -----------------------------------------------------------------------------
# Web Service — scales on CPU and ALB request count
# Min 2 (HA across AZs), Max 10
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "web" {
  for_each = local.environments

  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# CPU target tracking — scale out when average CPU > 70%
resource "aws_appautoscaling_policy" "web_cpu" {
  for_each = local.environments

  name               = "${var.app_name}-${each.key}-web-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.web[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.web[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ALB request count — scale out when requests per target > 1000/min
resource "aws_appautoscaling_policy" "web_requests" {
  for_each = local.environments

  name               = "${var.app_name}-${each.key}-web-request-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.web[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.web[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.web.arn_suffix}/${aws_lb_target_group.web[each.key].arn_suffix}"
    }

    target_value       = 1000
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# -----------------------------------------------------------------------------
# Clip Worker — scales on CPU (processing-bound workload)
# Min 1, Max 5
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "clip_worker" {
  for_each = local.environments

  max_capacity       = 5
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.clip_worker[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# CPU target tracking — scale out when average CPU > 70%
resource "aws_appautoscaling_policy" "clip_worker_cpu" {
  for_each = local.environments

  name               = "${var.app_name}-${each.key}-clip-worker-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.clip_worker[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.clip_worker[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.clip_worker[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 120
  }
}
