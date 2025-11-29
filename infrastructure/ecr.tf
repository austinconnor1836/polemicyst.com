resource "aws_ecr_repository" "llm_worker" {
  name                 = "${var.app_name}-llm-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "clip_worker" {
  name                 = "${var.app_name}-clip-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
