# Helm Deployment - Borderless Items Manager

This Helm chart packages the entire three-tier application (Frontend → Backend → PostgreSQL) for deployment to any Kubernetes cluster.

## Chart Structure

```
helm/
├── Chart.yaml              # Chart metadata
├── values.yaml             # Default configuration values
├── README.md               # This file
└── templates/
    ├── namespace.yaml
    ├── configmap.yaml
    ├── secret.yaml
    ├── postgres-pvc.yaml
    ├── postgres.yaml
    ├── backend.yaml
    └── frontend.yaml
```

## Prerequisites

- [Helm v3](https://helm.sh/docs/intro/install/)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/) or any Kubernetes cluster
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Before Deploying

**1. Update the CORS origin** in `helm/values.yaml` to match your frontend URL:
```yaml
config:
  corsOrigin: "http://<EC2_PUBLIC_IP>:8080"
```

**2. Update the DB credentials** in `helm/values.yaml` with your own base64-encoded values:
```bash
# Generate base64 values
echo -n 'your-username' | base64
echo -n 'your-password' | base64
```
Then update:
```yaml
secret:
  dbUser: <base64-encoded-username>
  dbPassword: <base64-encoded-password>
```

## Install

```bash
# From the project root
helm install borderless ./helm
```

## Verify

```bash
# Check all resources are created
helm status borderless

# Watch pods come up
kubectl get pods -n borderless -w

# Check all resources
kubectl get all -n borderless
```

## Access the App

```bash
# On Minikube
minikube service borderless-frontend-service -n borderless

# On EC2 via port-forward
kubectl port-forward service/borderless-frontend-service 8080:80 -n borderless --address 0.0.0.0
```

Then open `http://<EC2_PUBLIC_IP>:8080` in your browser.

## Upgrade

After making changes to `values.yaml` or templates:

```bash
helm upgrade borderless ./helm
```

After a new image is pushed to DockerHub:

```bash
helm upgrade borderless ./helm
# or force a rollout restart
kubectl rollout restart deployment/borderless-backend -n borderless
kubectl rollout restart deployment/borderless-frontend -n borderless
```

## Override Values at Deploy Time

You can override any value in `values.yaml` without editing the file:

```bash
# Change replica count
helm install borderless ./helm --set backend.replicas=3

# Change CORS origin
helm install borderless ./helm --set config.corsOrigin="http://1.2.3.4:8080"

# Change image tag
helm install borderless ./helm --set backend.tag=v2.0.0
```

## Uninstall

```bash
helm uninstall borderless
```

> Note: The PersistentVolumeClaim is not deleted automatically. To fully clean up:
> ```bash
> kubectl delete pvc borderless-postgres-pvc -n borderless
> kubectl delete namespace borderless
> ```

## Configuration Reference

| Parameter | Description | Default |
|---|---|---|
| `namespace` | Kubernetes namespace | `borderless` |
| `backend.image` | Backend image name | `johntoby/borderless-items-manager-backend` |
| `backend.tag` | Backend image tag | `latest` |
| `backend.replicas` | Number of backend pods | `2` |
| `frontend.image` | Frontend image name | `johntoby/borderless-items-manager-frontend` |
| `frontend.tag` | Frontend image tag | `latest` |
| `frontend.replicas` | Number of frontend pods | `2` |
| `frontend.nodePort` | NodePort for frontend service | `30080` |
| `postgres.tag` | Postgres image tag | `15-alpine` |
| `postgres.storage` | PVC storage size | `1Gi` |
| `postgres.storageClassName` | Storage class for PVC | `standard` |
| `config.corsOrigin` | Allowed CORS origin | `http://localhost:8080` |
| `secret.dbUser` | Base64 encoded DB username | `cG9zdGdyZXM=` |
| `secret.dbPassword` | Base64 encoded DB password | `cGFzc3dvcmQ=` |
