provider "aws" {
  region = var.region

  default_tags {
    tags = merge({ Project = var.name, ManagedBy = "terraform" }, var.tags)
  }
}

# The default network keeps the example short. A real environment would own its VPC.
data "aws_vpc" "default" {
  default = true
}

# The official Debian image, looked up rather than pinned by id, so a rebuild picks up the current patched one.
data "aws_ami" "debian" {
  most_recent = true
  owners      = ["136693071363"]

  filter {
    name   = "name"
    values = ["debian-12-amd64-*"]
  }
}

resource "aws_security_group" "host" {
  name_prefix = "${var.name}-host-"
  description = "ssh from one network, web from an allow-list, nothing else in"
  vpc_id      = data.aws_vpc.default.id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.host.id
  description       = "ssh from the admin network"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.admin_cidr
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = { for pair in setproduct(var.web_cidrs, [80, 443]) : "${pair[0]}:${pair[1]}" => pair }

  security_group_id = aws_security_group.host.id
  description       = "web from the allow-list"
  ip_protocol       = "tcp"
  from_port         = each.value[1]
  to_port           = each.value[1]
  cidr_ipv4         = each.value[0]
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  description       = "outbound: package mirrors, the image registry"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_instance" "host" {
  ami                    = data.aws_ami.debian.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.host.id]

  # IMDSv2 only: a request-forgery bug in an application cannot read the instance's credentials with one GET.
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 20
  }

  tags = { Name = "${var.name}-host" }
}

# An address that outlives the instance, so DNS does not have to change when the instance is replaced.
resource "aws_eip" "host" {
  instance = aws_instance.host.id
  domain   = "vpc"
}

resource "aws_ecr_repository" "app" {
  name                 = "${var.name}/app"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keep the last twenty images; older ones are what a rollback never needs.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}
