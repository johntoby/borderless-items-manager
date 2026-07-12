# Monitoring Setup - Prometheus & Grafana

This uses the [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) Helm chart to deploy Prometheus, Grafana, and Alertmanager.

## What You Get

- **Prometheus** — scrapes metrics from the backend `/metrics` endpoint
- **Grafana** — dashboards for visualizing metrics (pre-configured with Prometheus as data source)
- **Alertmanager** — handles alerts from Prometheus rules
- **Node Exporter** — host-level metrics (CPU, memory, disk)
- **kube-state-metrics** — Kubernetes object metrics (pods, deployments, etc.)

## Prerequisites

- Helm v3 installed
- Minikube running
- The borderless app deployed (`helm install borderless ./helm`)

## Install

```bash
# Add the Prometheus community Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f helm/monitoring/values-monitoring.yaml

# Apply the ServiceMonitor for the backend
kubectl apply -f helm/monitoring/servicemonitor.yaml
```

## Verify

```bash
# Check all monitoring pods are running
kubectl get pods -n monitoring

# Check Prometheus is scraping the backend
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring --address 0.0.0.0
```
Open `http://<EC2_PUBLIC_IP>:9090` → Status → Targets → look for `borderless-backend`.

## Access Grafana

```bash
kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring --address 0.0.0.0
```

Open `http://<EC2_PUBLIC_IP>:3000`

- **Username:** `admin`
- **Password:** `admin`

## EC2 Security Group Rules

| Type | Protocol | Port | Purpose |
|---|---|---|---|
| Custom TCP | TCP | 9090 | Prometheus UI |
| Custom TCP | TCP | 3000 | Grafana UI |
| Custom TCP | TCP | 31000 | Grafana NodePort (alternative) |

## Application Metrics Available

These are exposed by the backend at `/metrics`:

| Metric | Type | Description |
|---|---|---|
| `http_requests_total` | Counter | Total HTTP requests by method, route, status |
| `http_request_duration_seconds` | Histogram | Request latency distribution |
| `http_errors_total` | Counter | Total 4xx/5xx errors |
| `http_active_connections` | Gauge | In-flight requests |
| Node.js default metrics | Various | CPU, memory, event loop, GC |

## Example PromQL Queries for Grafana

```promql
# Request rate (requests per second)
rate(http_requests_total{app="borderless-backend"}[5m])

# Average response latency
rate(http_request_duration_seconds_sum{app="borderless-backend"}[5m]) / rate(http_request_duration_seconds_count{app="borderless-backend"}[5m])

# Error rate (percentage)
rate(http_errors_total{app="borderless-backend"}[5m]) / rate(http_requests_total{app="borderless-backend"}[5m]) * 100

# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{app="borderless-backend"}[5m]))

# Active connections
http_active_connections{app="borderless-backend"}
```

## Alertmanager Configuration (Email via Gmail)

Alertmanager is configured to send email alerts when critical conditions are detected.

### Setup

**1. Generate a Gmail App Password:**
- Go to https://myaccount.google.com/apppasswords
- Select "Mail" → "Other (Custom name)" → name it `Alertmanager`
- Copy the 16-character password

**2. Update credentials in `values-monitoring.yaml`:**
```yaml
alertmanager:
  config:
    global:
      smtp_from: "your-email@gmail.com"
      smtp_auth_username: "your-email@gmail.com"
      smtp_auth_password: "your-app-password"
    receivers:
      - name: "email"
        email_configs:
          - to: "your-email@gmail.com"
```

> **Security:** Never commit real credentials to git. Use `--set` at deploy time instead:
> ```bash
> helm upgrade monitoring prometheus-community/kube-prometheus-stack \
>   -n monitoring -f helm/monitoring/values-monitoring.yaml \
>   --set alertmanager.config.global.smtp_auth_password="your-app-password"
> ```

**3. Apply alert rules:**
```bash
kubectl apply -f helm/monitoring/alertrules.yaml
```

### Alert Rules

| Alert | Condition | Severity |
|---|---|---|
| HighErrorRate | >5% error rate for 2 min | Critical |
| HighLatency | p95 latency >1s for 2 min | Warning |
| PodDown | All backend pods down for 1 min | Critical |
| PostgresDown | Postgres pod down for 1 min | Critical |
| HighMemoryUsage | Backend using >85% memory limit for 2 min | Warning |

Alerts send both a **firing** and **resolved** email notification.

### Verify Alertmanager

```bash
# Port-forward Alertmanager UI
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager 9093:9093 -n monitoring --address 0.0.0.0
```
Open `http://<EC2_PUBLIC_IP>:9093` to see active alerts and silences.

### EC2 Security Group (additional)

| Type | Protocol | Port | Purpose |
|---|---|---|---|
| Custom TCP | TCP | 9093 | Alertmanager UI |

## Uninstall

```bash
helm uninstall monitoring -n monitoring
kubectl delete namespace monitoring
kubectl delete -f helm/monitoring/servicemonitor.yaml
kubectl delete -f helm/monitoring/alertrules.yaml
```
