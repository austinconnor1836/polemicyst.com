resource "aws_ecr_repository" "web" {
  name                 = "${var.app_name}-web"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
