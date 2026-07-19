variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS worker nodes"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository in the format owner/repo-name"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch allowed to assume the IAM role"
  type        = string
}

variable "db_user" {
  description = "PostgreSQL username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "smtp_password" {
  description = "Gmail SMTP app password for Alertmanager"
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
}
