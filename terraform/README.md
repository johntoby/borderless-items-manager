# Terraform - EKS & ECR Infrastructure

Provisions the AWS infrastructure for the Borderless Items Manager:
- VPC with public and private subnets across 2 AZs
- EKS cluster with managed node group
- ECR repositories for backend and frontend images

## Prerequisites

- [Terraform >= 1.5.0](https://developer.hashicorp.com/terraform/install)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- AWS credentials configured (`aws configure`)

## Deploy Infrastructure

```bash
cd terraform

# Initialise Terraform and download modules
terraform init

# Preview what will be created
terraform plan

# Create the infrastructure (~15 minutes)
terraform apply
```

## After Apply

Terraform will output the ECR URLs and a kubectl config command:

```bash
# Configure kubectl to connect to EKS
aws eks update-kubeconfig --region us-east-1 --name borderless-cluster

# Verify connection
kubectl get nodes
```

## Update values-eks.yaml

Replace the placeholders with the ECR URLs from the Terraform output:

```bash
# Get ECR URLs
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

Also update `CORS_ORIGIN` after getting the LoadBalancer URL:
```bash
kubectl get svc borderless-frontend-service -n borderless
```

## GitHub Actions Secrets Required

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS access key with EKS and ECR permissions |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key |

The IAM user/role needs these permissions:
- `ecr:*` — push/pull images
- `eks:DescribeCluster` — connect to cluster
- `eks:*` — deploy to cluster

## Customise

Edit `terraform/variables.tf` to change:

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `us-east-1` | AWS region |
| `cluster_name` | `borderless-cluster` | EKS cluster name |
| `node_instance_type` | `t3.medium` | Worker node size |

## Destroy Infrastructure

```bash
cd terraform
terraform destroy
```

> **Note:** Delete the EKS cluster before destroying to avoid orphaned load balancers blocking VPC deletion:
> ```bash
> helm uninstall borderless -n borderless
> helm uninstall monitoring -n monitoring
> terraform destroy
> ```
