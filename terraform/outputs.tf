output "node_role_arn" {
  description = "IAM role ARN for EKS worker nodes"
  value       = aws_iam_role.node.arn
}

output "csi_role_arn" {
  description = "IAM role ARN for the Secrets Store CSI driver service account"
  value       = aws_iam_role.csi_secrets.arn
}

output "app_secret_arn" {
  description = "ARN of the app secrets in Secrets Manager"
  value       = aws_secretsmanager_secret.app.arn
}

output "alertmanager_secret_arn" {
  description = "ARN of the Alertmanager SMTP secret in Secrets Manager"
  value       = aws_secretsmanager_secret.alertmanager.arn
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC"
  value       = aws_iam_role.github_actions.arn
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_region" {
  description = "AWS region"
  value       = var.aws_region
}

output "ecr_backend_url" {
  description = "ECR backend repository URL"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_frontend_url" {
  description = "ECR frontend repository URL"
  value       = aws_ecr_repository.frontend.repository_url
}

output "configure_kubectl" {
  description = "Command to configure kubectl"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
