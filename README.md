# Borderless Items Manager

A three-tier application (Frontend → Backend → PostgreSQL) containerized with Docker and deployed to AWS EKS via Helm. Infrastructure is provisioned with Terraform. Secrets are managed by AWS Secrets Manager. CI/CD runs on GitHub Actions using OIDC authentication — no AWS access keys stored anywhere.

## Architecture

```
                        ┌─────────────────────────────┐
                        │        GitHub Actions        │
                        │  (OIDC — no static keys)     │
                        └────────────┬────────────────┘
                                     │ push to monitoring branch
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

This is the only secret needed. The pipeline authenticates to AWS via OIDC — no access keys.

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

Authentication to AWS uses GitHub OIDC — the job requests a short-lived token from GitHub, exchanges it with AWS STS for temporary credentials, and those credentials expire when the job ends. No static keys are stored or rotated.

See `SECRETS.md` for a detailed explanation of how OIDC works.

## Secrets Management

No credentials are stored in this repository or in GitHub Secrets (except `AWS_ROLE_ARN`, which is a role identifier, not a credential).

| Secret | Where it lives |
|---|---|
| `DB_USER`, `DB_PASSWORD` | AWS Secrets Manager — `borderless-cluster/app` |
| Gmail SMTP password | AWS Secrets Manager — `borderless-cluster/alertmanager` |
| AWS credentials for CI | Not stored — OIDC tokens used instead |

At pod startup, the Secrets Store CSI driver pulls values from Secrets Manager using IRSA (IAM Roles for Service Accounts) and syncs them into native Kubernetes Secret objects. The app reads them as normal environment variables.

See `SECRETS.md` for the full guide including setup, rotation, and verification steps.

## Monitoring

The monitoring stack runs in the `monitoring` namespace and is deployed automatically by the CI pipeline.

| Tool | Access | Default credentials |
|---|---|---|
| Grafana | `kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring` | `admin` / `admin` |
| Prometheus | `kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090 -n monitoring` | — |

A custom Grafana dashboard is included at `helm/monitoring/grafana-dashboard.json` with 8 panels covering request rate, error rate, latency (p50/p95/p99), active connections, requests by route, and memory usage.

Alertmanager is configured to send email alerts to `obacloud007@gmail.com` via Gmail SMTP. Five alert rules are defined in `helm/monitoring/alertrules.yaml`:

- `HighErrorRate` — error rate > 5% for 5 minutes
- `HighLatency` — p99 latency > 1s for 5 minutes
- `PodDown` — any pod in the `borderless` namespace not running
- `PostgresDown` — PostgreSQL pod not running
- `HighMemoryUsage` — memory usage > 80% of limit

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
# Check all pods are running
kubectl get pods -n borderless
kubectl get pods -n monitoring

# Check services
kubectl get svc -n borderless

# Check secrets were synced from Secrets Manager
kubectl get secret borderless-secret -n borderless
kubectl get secret alertmanager-smtp -n monitoring

# Check nodes have joined the cluster
kubectl get nodes
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
