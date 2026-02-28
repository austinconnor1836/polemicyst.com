resource "aws_security_group" "rds" {
  name        = "${var.app_name}-rds-sg"
  description = "Allow Postgres from ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "db" {
  for_each = var.environments

  identifier              = "${var.app_name}-${each.key}-db"
  engine                  = "postgres"
  engine_version          = var.db_engine_version != "" ? var.db_engine_version : null
  instance_class          = each.value.db_instance_class
  allocated_storage       = each.value.db_allocated_storage
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = each.value.db_name
  username                = var.db_username
  password                = var.db_password
  multi_az                = each.value.db_multi_az
  publicly_accessible     = false
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  backup_retention_period = each.value.db_backup_retention
  deletion_protection     = each.value.db_deletion_protection
  skip_final_snapshot     = each.value.db_skip_final_snapshot
  apply_immediately       = true
}

# Migrate existing prod RDS instance into the new for_each address
moved {
  from = aws_db_instance.main
  to   = aws_db_instance.db["prod"]
}
