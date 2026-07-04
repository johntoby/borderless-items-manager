# Kubernetes Three-Tier App - Borderless Items Manager

A simple three-tier application (Frontend → Backend → PostgreSQL) containerized with Docker and deployed to Kubernetes via Minikube.

## Project Structure

```
.
├── frontend/               # Nginx-served static HTML/JS
├── backend/                # Node.js Express REST API
├── k8s/                    # Kubernetes manifests
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── postgres-pvc.yaml
│   ├── postgres.yaml
│   ├── backend.yaml
│   └── frontend.yaml
└── .github/workflows/      # GitHub Actions CI/CD
    └── ci.yaml
```

## Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Docker](https://docs.docker.com/get-docker/)

## CI/CD Setup (GitHub Actions)

Add the following secrets to your GitHub repository (`Settings → Secrets → Actions`):

| Secret | Description |
|---|---|
| `DOCKERHUB_USERNAME` | Your DockerHub username |
| `DOCKERHUB_TOKEN` | Your DockerHub access token |

The pipeline runs on every push to `main`:
1. Runs backend unit tests
2. Builds and pushes `k8s-backend` and `k8s-frontend` images to DockerHub

## Before Deploying to Kubernetes

DockerHub username `johntoby` is already set in `k8s/backend.yaml` and `k8s/frontend.yaml`.

## Deploy to Minikube

```bash
# Start minikube
minikube start

# Apply all manifests in order
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres-pvc.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml

# Wait for pods to be ready
kubectl get pods -n borderless -w

# Access the frontend
minikube service borderless-frontend-service -n borderless
```

## Updating the App After a New Image Push

After CI pushes a new image to DockerHub, trigger a rolling restart:

```bash
kubectl rollout restart deployment/borderless-backend -n borderless
kubectl rollout restart deployment/borderless-frontend -n borderless
```

## Accessing the App on AWS EC2

When running Minikube on an EC2 instance, the NodePort is bound to Minikube's internal VM IP and is not reachable from outside. Use `kubectl port-forward` to expose the frontend through the EC2's public IP instead.

**1. Forward the frontend service to port 8080:**
```bash
kubectl port-forward service/borderless-frontend-service 8080:80 --address 0.0.0.0
```

**2. Open in your browser:**
```
http://<EC2_PUBLIC_IP>:8080
```

**3. Allow port 8080 in your EC2 Security Group (inbound rule):**

| Type | Protocol | Port | Source |
|---|---|---|---|
| Custom TCP | TCP | 8080 | 0.0.0.0/0 (or your IP) |

**4. To keep it running after disconnecting from the terminal:**
```bash
# Using nohup
nohup kubectl port-forward service/borderless-frontend-service 8080:80 --address 0.0.0.0 &

# Or using tmux (recommended)
tmux new -s portforward
kubectl port-forward service/borderless-frontend-service 8080:80 --address 0.0.0.0
# Press Ctrl+B then D to detach
```

## CORS Configuration

The backend restricts which frontend origins can make API requests. This prevents malicious websites from calling your API on behalf of your users.

The allowed origin is set via `CORS_ORIGIN` in `k8s/configmap.yaml`. Before deploying, update it to match your actual frontend URL:

```yaml
CORS_ORIGIN: "http://<EC2_PUBLIC_IP>:8080"
```

How it works:

| Request from | Allowed? |
|---|---|
| Your frontend URL | ✅ Yes |
| Any other website | ❌ No (blocked by browser) |

> **Note:** CORS is enforced by the browser only. Tools like `curl` or Postman bypass it entirely. It is not a substitute for authentication — it is one layer of protection.

## Verify

```bash
kubectl get deployments -n borderless
kubectl get services -n borderless
kubectl get pods -n borderless
```
