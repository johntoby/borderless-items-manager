# Terraform — AWS Infrastructure

Provisions all AWS infrastructure for the Borderless Items Manager EKS deployment.

## What Gets Created

| Resource | Details |
|---|---|
| VPC | 10.0.0.0/16, 2 AZs, public + private subnets, NAT gateway |
| EKS Cluster | v1.29, worker nodes in private subnets |
| EKS Node IAM Role | EC2 role with the 3 required AWS-managed policies for kubelets |
| `aws-auth` ConfigMap | Maps the node role to `system:nodes` so workers can join the cluster |
| ECR Repositories | `borderless-cluster-backend`, `borderless-cluster-frontend` (lifecycle: keep last 5 images) |
| GitHub OIDC Provider | Registers `token.actions.githubusercontent.com` as a trusted identity provider in AWS |
| GitHub Actions IAM Role | Assumed by CI via OIDC — scoped to `johntoby/borderless-items-manager` on the `eks` branch only |
| CSI Driver IAM Role | IRSA role assumed by the `borderless-csi-sa` ServiceAccount in the `borderless` namespace |
| Secrets Manager — `borderless-cluster/app` | Stores `DB_USER` and `DB_PASSWORD` |
| Secrets Manager — `borderless-cluster/alertmanager` | Stores `smtp_password` for Alertmanager Gmail alerts |

## IAM Roles Overview

There are three distinct IAM roles, each with a different trust relationship and purpose:

```
┌─────────────────────────────────────────────────────────────────────┐
│  borderless-cluster-github-actions-role                             │
│  Trusted by: GitHub OIDC (token.actions.githubusercontent.com)      │
│  Assumed by: GitHub Actions CI jobs on the eks branch               │
│  Permissions: ECR push, EKS describe, Secrets Manager read/write   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  borderless-cluster-node-role                                       │
│  Trusted by: ec2.amazonaws.com                                      │
│  Assumed by: EC2 worker node instances                              │
│  Permissions: AmazonEKSWorkerNodePolicy                             │
│               AmazonEKS_CNI_Policy                                  │
│               AmazonEC2ContainerRegistryReadOnly                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  borderless-cluster-csi-secrets-role                                │
│  Trusted by: EKS OIDC provider (IRSA)                              │
│  Assumed by: borderless-csi-sa ServiceAccount in borderless ns      │
│  Permissions: Secrets Manager GetSecretValue, DescribeSecret        │
└─────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Terraform >= 1.5.0](https://developer.hashicorp.com/terraform/install)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured with credentials that can create IAM, EKS, VPC, ECR, and Secrets Manager resources
- `kubectl` installed locally

## Configuration

All variables are defined in `variables.tf` with no defaults — every value must be supplied via `terraform.tfvars`.

### Step 1 — Create your tfvars file

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
aws_region         = "us-east-1"
cluster_name       = "borderless-cluster"
node_instance_type = "t3.medium"
github_repo        = "johntoby/borderless-items-manager"
github_branch      = "eks"

tags = {
  Project     = "borderless-items-manager"
  Environment = "production"
  ManagedBy   = "terraform"
}

# Sensitive — fill in real values
db_user       = "your-db-username"
db_password   = "your-db-password"
smtp_password = "your-gmail-app-password"
```

> `terraform.tfvars` is gitignored. Never commit it.

### Step 2 — Deploy

```bash
terraform init
terraform plan
terraform apply
```

Apply takes approximately 15–20 minutes, most of which is EKS cluster creation.

## After Apply

### Configure kubectl

```bash
aws eks update-kubeconfig --region us-east-1 --name borderless-cluster

# Verify nodes have joined the cluster
kubectl get nodes
```

### Add the GitHub Actions secret

Terraform registers the GitHub OIDC provider and creates the IAM role. You only need to add one secret to GitHub — the role ARN:

1. Go to your repository → **Settings → Secrets and variables → Actions**
2. Add a new secret:

| Name | Value |
|---|---|
| `AWS_ROLE_ARN` | `terraform output -raw github_actions_role_arn` |

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` are needed. The CI pipeline authenticates via short-lived OIDC tokens.

### Update helm/values-eks.yaml

Replace the ECR image placeholders with the actual URLs from Terraform output:

```bash
terraform output ecr_backend_url
terraform output ecr_frontend_url
```

Update `helm/values-eks.yaml`:

```yaml
backend:
  image: <ecr_backend_url>

frontend:
  image: <ecr_frontend_url>
```

### Update CORS origin

After the first deployment, get the frontend LoadBalancer URL and update `CORS_ORIGIN` in `helm/templates/configmap.yaml`:

```bash
kubectl get svc borderless-frontend-service -n borderless
```

## Outputs

| Output | Description |
|---|---|
| `github_actions_role_arn` | Paste this into GitHub Secrets as `AWS_ROLE_ARN` |
| `node_role_arn` | IAM role ARN attached to EKS worker nodes |
| `csi_role_arn` | IRSA role ARN for the Secrets Store CSI driver — injected by CI at deploy time |
| `app_secret_arn` | ARN of `borderless-cluster/app` in Secrets Manager |
| `alertmanager_secret_arn` | ARN of `borderless-cluster/alertmanager` in Secrets Manager |
| `ecr_backend_url` | Full ECR URL for the backend image |
| `ecr_frontend_url` | Full ECR URL for the frontend image |
| `cluster_name` | EKS cluster name |
| `cluster_endpoint` | EKS API server endpoint |
| `configure_kubectl` | Ready-to-run `aws eks update-kubeconfig` command |

```bash
# Print all outputs
terraform output

# Print a single value (e.g. for scripting)
terraform output -raw github_actions_role_arn
```

## How Secrets Flow at Runtime

Terraform stores credentials in AWS Secrets Manager once during `terraform apply`. After that, no pipeline or manifest ever handles the raw values:

```
terraform apply (once, locally)
      │
      ▼
AWS Secrets Manager
  borderless-cluster/app          → DB_USER, DB_PASSWORD
  borderless-cluster/alertmanager → smtp_password
      │
      ▼ (at pod startup, via IRSA)
Secrets Store CSI Driver
      │
      ▼
K8s Secret: borderless-secret     → consumed by backend pod env vars
K8s Secret: alertmanager-smtp     → consumed by Alertmanager as a file mount
```

See `SECRETS.md` in the project root for the full secrets management guide.

## Destroying Infrastructure

Clean up Helm releases first to avoid orphaned load balancers that would block VPC deletion:

```bash
helm uninstall borderless -n borderless
helm uninstall monitoring -n monitoring

# Wait for load balancers to be deprovisioned
kubectl get svc -A

# Then destroy all Terraform-managed resources
terraform destroy
```
