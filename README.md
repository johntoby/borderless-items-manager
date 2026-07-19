# Borderless Items Manager

A three-tier application (Frontend → Backend → PostgreSQL) containerized with Docker and deployed to AWS EKS via Helm. Infrastructure is provisioned with Terraform. Secrets are managed by AWS Secrets Manager. CI/CD runs on GitHub Actions using OIDC authentication — no AWS access keys stored anywhere.

## Architecture

```
                        ┌─────────────────────────────┐
                        │        GitHub Actions        │
                        │  (OIDC — no static keys)     │
                        └────────────┬────────────────┘
                                     │ push to eks branch
                    ┌────────────────▼────────────────┐
                    │              AWS                 │
                    │                                  │
                    │  ECR ◄── build & push images     │
                    │                                  │
                    │  EKS Cluster                     │
                    │  ├── borderless (namespace)      │
                    │  │   ├── Frontend  (LoadBalancer)│
                    │  │   ├── Backend                 │
                    │  │   └── PostgreSQL (StatefulSet)│
                    │  └── monitoring (namespace)      │
                    │      ├── Prometheus              │
                    │      ├── Grafana                 │
                    │      └── Alertmanager            │
                    │                                  │
                    │  Secrets Manager                 │
                    │  ├── borderless-cluster/app      │
                    │  └── borderless-cluster/         │
                    │      alertmanager                │
                    └──────────────────────────────────┘
```

## Project Structure

```
.
├── backend/                    # Node.js Express REST API
│   ├── index.js                # App with prom-client metrics, DB retry, CORS
│   ├── index.test.js           # Jest unit tests
│   ├── Dockerfile
│   └── package.json
├── frontend/                   # Nginx-served static HTML/JS
│   ├── index.html              # Dark-themed UI — add, edit, delete items
│   ├── nginx.conf
│   └── Dockerfile
├── helm/                       # Helm chart for the application
│   ├── templates/
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml
│   │   ├── secret.yaml         # SecretProviderClass + ServiceAccount (CSI)
│   │   ├── postgres.yaml       # StatefulSet
│   │   ├── postgres-pvc.yaml
│   │   ├── backend.yaml
│   │   └── frontend.yaml
│   ├── monitoring/             # kube-prometheus-stack config
│   │   ├── values-monitoring.yaml
│   │   ├── servicemonitor.yaml
│   │   ├── alertrules.yaml
│   │   ├── grafana-dashboard.json
│   │   ├── alertmanager-secretprovider.yaml
│   │   └── alertmanager-secret-sync.yaml
│   ├── values.yaml             # Minikube values (local dev)
│   └── values-eks.yaml         # EKS values (production)
├── terraform/                  # AWS infrastructure
│   ├── main.tf                 # VPC, EKS, ECR, IAM roles, Secrets Manager
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   └── README.md
├── k8s/                        # Raw manifests (local Minikube only)
├── .github/workflows/
│   └── ci.yaml                 # Test → Build → Push to ECR → Deploy to EKS
├── SECRETS.md                  # Full secrets management guide
└── README.md
```

## Prerequisites

- [Terraform >= 1.5.0](https://developer.hashicorp.com/terraform/install)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm >= 3](https://helm.sh/docs/intro/install/)
- [Docker](https://docs.docker.com/get-docker/)

## First-Time Setup

### This is the correct order for the EKS deployment: 

1. Fill in terraform.tfvars with real credentials
         │
         ▼
2. terraform init && terraform apply locally
   (creates VPC, EKS, ECR, IAM roles, Secrets Manager, KMS)
         │
         ▼
3. Add AWS_ROLE_ARN and GRAFANA_ADMIN_PASSWORD to GitHub Secrets
         │
         ▼
4. Update helm/values-eks.yaml with real ECR URLs from terraform output
         │
         ▼
5. git push origin eks  ← pipeline runs end to end
         │
         ▼
6. kubectl get svc borderless-frontend-service -n borderless
   → copy the LoadBalancer URL
         │
         ▼
7. Update corsOrigin in helm/values-eks.yaml
   git push origin eks  ← re-deploy with correct CORS


### 1 — Provision AWS infrastructure with Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your real values
terraform init
terraform apply
```

Terraform creates the VPC, EKS cluster, ECR repos, all IAM roles, and pushes your credentials into AWS Secrets Manager. See `terraform/README.md` for the full breakdown.

### 2 — Add the GitHub Actions secret

After `terraform apply`, add one secret to your GitHub repository under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `terraform output -raw github_actions_role_arn` |
| `GRAFANA_ADMIN_PASSWORD` | A strong password for the Grafana admin user |

These are the only secrets needed. The pipeline authenticates to AWS via OIDC — no access keys.

### 3 — Update helm/values-eks.yaml

Replace the ECR image placeholders with the URLs from Terraform output:

```bash
terraform output ecr_backend_url
terraform output ecr_frontend_url
```

### 4 — Push to the monitoring branch

```bash
git push origin monitoring
```

The pipeline runs automatically:

1. Runs backend unit tests
2. Builds and pushes images to ECR
3. Installs the Secrets Store CSI driver on the cluster
4. Deploys the app via Helm — secrets are synced from AWS Secrets Manager into the cluster at pod startup
5. Deploys the monitoring stack (Prometheus, Grafana, Alertmanager)

## CI/CD Pipeline

The pipeline triggers on every push to the `monitoring` branch. It has three jobs:

```
test-backend  ──►  build-and-push  ──►  deploy
                   (ECR)                (EKS via Helm)
```

`build-and-push` steps in order:
1. Configure AWS credentials via OIDC
2. Log in to ECR (produces the registry URL used by the push steps)
3. Set up Docker Buildx
4. Build and push backend and frontend images

`deploy` steps in order:
1. Configure AWS credentials via OIDC
2. Log in to ECR
3. Update kubeconfig for EKS
4. Install Secrets Store CSI driver and AWS provider into `kube-system`
5. Fetch the CSI IRSA role ARN from AWS
6. Deploy the app via Helm — injects ECR image URLs and CSI role ARN at deploy time
7. Deploy the monitoring stack — renders `values-monitoring.yaml` and `alertmanager-secretprovider.yaml` through `envsubst` to inject `GRAFANA_ADMIN_PASSWORD`, `CSI_ROLE_ARN`, and `CLUSTER_NAME` before applying
8. Print the frontend LoadBalancer URL

Authentication to AWS uses GitHub OIDC — the job requests a short-lived token from GitHub, exchanges it with AWS STS for temporary credentials, and those credentials expire when the job ends. No static keys are stored or rotated.

See `SECRETS.md` for a detailed explanation of how OIDC works.

## Secrets Management

No credentials are stored in this repository or in GitHub Secrets (except `AWS_ROLE_ARN`, which is a role identifier, and `GRAFANA_ADMIN_PASSWORD`).

| Secret | Where it lives |
|---|---|
| `DB_USER`, `DB_PASSWORD` | AWS Secrets Manager — `borderless-cluster/app` |
| Gmail SMTP password | AWS Secrets Manager — `borderless-cluster/alertmanager` |
| Grafana admin password | GitHub Secret — `GRAFANA_ADMIN_PASSWORD` |
| AWS credentials for CI | Not stored — OIDC tokens used instead |

Both Secrets Manager secrets are encrypted at rest with a customer-managed KMS key (`alias/borderless-cluster-secrets`) with automatic key rotation enabled.

At pod startup, the Secrets Store CSI driver pulls values from Secrets Manager using IRSA (IAM Roles for Service Accounts) and syncs them into native Kubernetes Secret objects. Both the backend and PostgreSQL pods mount the CSI volume, guaranteeing `borderless-secret` exists before either pod reads from it. The app reads credentials as normal environment variables.

See `SECRETS.md` for the full guide including setup, rotation, and verification steps.

## Monitoring

The monitoring stack runs in the `monitoring` namespace and is deployed automatically by the CI pipeline.

| Tool | Access | Credentials |
|---|---|---|
| Grafana | `kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring` | `admin` / value of `GRAFANA_ADMIN_PASSWORD` GitHub Secret |
| Prometheus | `kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090 -n monitoring` | — |

A custom Grafana dashboard is included at `helm/monitoring/grafana-dashboard.json` with 8 panels covering request rate, error rate, latency (p50/p95/p99), active connections, requests by route, and memory usage.

Alertmanager is configured to send email alerts to `obacloud007@gmail.com` via Gmail SMTP. Five alert rules are defined in `helm/monitoring/alertrules.yaml`:

- `HighErrorRate` — error rate > 5% for 2 minutes
- `HighLatency` — p95 latency > 1s for 2 minutes
- `PodDown` — backend deployment has 0 available replicas for 1 minute
- `PostgresDown` — PostgreSQL StatefulSet has 0 ready replicas for 1 minute
- `HighMemoryUsage` — backend memory usage > 85% of limit for 2 minutes

## Application

The app is a simple items manager with a dark-themed UI. It supports creating, editing, and deleting items stored in PostgreSQL.

**Backend** (`/api/items`):
- `GET /api/items` — list all items
- `POST /api/items` — create an item (max 200 chars)
- `PUT /api/items/:id` — update an item
- `DELETE /api/items/:id` — delete an item
- `GET /health` — health check (used by liveness and readiness probes)
- `GET /metrics` — Prometheus metrics endpoint

**Backend features:**
- DB connection retry logic (10 retries, 3s delay)
- CORS restricted to `CORS_ORIGIN` env var
- Generic error messages (no internal details leaked)
- Input length validation

## CORS Configuration

After deployment, update `CORS_ORIGIN` in `helm/templates/configmap.yaml` to match your frontend LoadBalancer URL:

```bash
# Get the LoadBalancer URL
kubectl get svc borderless-frontend-service -n borderless
```

```yaml
CORS_ORIGIN: "http://<LOAD_BALANCER_URL>"
```

Then trigger a rolling restart:

```bash
kubectl rollout restart deployment/borderless-backend -n borderless
```

## Verify Deployment

```bash
# Check nodes have joined the cluster
kubectl get nodes

# Check all pods are running
kubectl get pods -n borderless
kubectl get pods -n monitoring

# Check services and get the frontend LoadBalancer URL
kubectl get svc -n borderless

# Check the CSI driver is running on every node
kubectl get pods -n kube-system | grep secrets-store

# Check secrets were synced from Secrets Manager
kubectl get secret borderless-secret -n borderless
kubectl get secret alertmanager-smtp -n monitoring

# Check the SecretProviderClass status
kubectl describe secretproviderclass borderless-aws-secrets -n borderless

# Verify the backend is reading secrets correctly
kubectl logs -l app=borderless-backend -n borderless | head -20
```

## Rolling Update After a New Image Push

The CI pipeline handles this automatically on every push to `monitoring`. To trigger manually:

```bash
kubectl rollout restart deployment/borderless-backend -n borderless
kubectl rollout restart deployment/borderless-frontend -n borderless
```

## Local Development (Minikube)

The `k8s/` directory contains raw manifests for local Minikube use. The `helm/values.yaml` file contains Minikube-specific values (DockerHub images, `storageClassName: standard`, NodePort).

> The `k8s/secret.yaml` file contains placeholder credentials only. Real credentials are never committed — they live in AWS Secrets Manager for EKS deployments.

```bash
minikube start
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres-pvc.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
minikube service borderless-frontend-service -n borderless
```

## Further Reading

- `terraform/README.md` — infrastructure details, IAM roles, outputs
- `SECRETS.md` — OIDC and Secrets Manager setup guide
- `helm/README.md` — Helm chart values reference
- `helm/monitoring/README.md` — monitoring stack setup and Grafana dashboard import
