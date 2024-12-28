terraform {
 required_version = "~> 1.3"

 required_providers {
  aws = {
   source  = "hashicorp/aws"
   version = "~> 4.56"
  }
  docker = {
   source  = "kreuzwerker/docker"
   version = "~> 3.0"
  }
 }
}

locals {
  docker_image = "next-email-app:latest"
  subnet_id = "subnet-05e86722c54ccbe96"
  security_group = "sg-074729ee9559a841a"
  name = "next-email-app"
}

provider "aws" {
  region = "us-east-2"
}

# * Give Docker permission to pusher Docker images to AWS
data "aws_caller_identity" "this" {}
data "aws_ecr_authorization_token" "this" {}
data "aws_region" "this" {}
locals { 
  ecr_address = format("%v.dkr.ecr.%v.amazonaws.com", data.aws_caller_identity.this.account_id, data.aws_region.this.name)
  
}
provider "docker" {
 registry_auth {
  address  = local.ecr_address
  password = data.aws_ecr_authorization_token.this.password
  username = data.aws_ecr_authorization_token.this.user_name
 }
}

resource "aws_ecs_cluster" "main" {
  name = "nextjs-email-app-cluster"
}

resource "aws_ecs_task_definition" "nextjs" {
  family                   = "nextjs-task"
  container_definitions    = <<DEFINITION
  [
    {
      "name": "nextjs-container",
      "image": "${local.docker_image}",
      "memory": 512,
      "cpu": 256,
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000
        }
      ]
    }
  ]
  DEFINITION
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn
  memory                   = "512"
  cpu                      = "256"
}

resource "aws_ecs_service" "main" {
  name            = "nextjs-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.nextjs.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = [local.subnet_id]
    security_groups = [local.security_group]
  }
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecsTaskExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      },
    ]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  ]
}

module "ecr" {
 source  = "terraform-aws-modules/ecr/aws"
 version = "~> 1.6.0"

 repository_force_delete = true
 repository_name = local.name
 repository_lifecycle_policy = jsonencode({
  rules = [{
   action = { type = "expire" }
   description = "Delete all images except a handful of the newest images"
   rulePriority = 1
   selection = {
    countNumber = 3
    countType = "imageCountMoreThan"
    tagStatus = "any"
   }
  }]
 })
}

# * Build our Image locally with the appropriate name so that we can push 
# * our Image to our Repository in AWS. Also, give it a random image tag.
resource "docker_image" "this" {
 name = format("%v:%v", module.ecr.repository_url, formatdate("YYYY-MM-DD'T'hh-mm-ss", timestamp()))

 build { context = "." } # Path to our local Dockerfile
}

# * Push our container image to our ECR.
resource "docker_registry_image" "this" {
 keep_remotely = true # Do not delete old images when a new image is pushed
 name = resource.docker_image.this.name
}