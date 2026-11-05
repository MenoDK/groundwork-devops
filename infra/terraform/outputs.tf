output "public_ip" {
  description = "Where the host answers."
  value       = aws_eip.host.public_ip
}

output "repository_url" {
  description = "Where images are pushed. Tags are immutable: a tag, once pushed, always names the same image."
  value       = aws_ecr_repository.app.repository_url
}

output "security_group_id" {
  description = "The security group, for reference from other stacks."
  value       = aws_security_group.host.id
}
