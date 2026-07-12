

# Kubernetes Application Monitoring with Prometheus and Grafana

## Project Overview

In this project, we will implement a complete monitoring solution for a Kubernetes-based three-tier application running on Minikube.

The goal is to introduce a production-style monitoring architecture where we can:

* Monitor Kubernetes cluster health
* Monitor application performance
* Track resource utilization
* Visualize metrics through dashboards
* Identify failures and performance bottlenecks

The monitoring stack we will implement consists of:

* **Prometheus** - Metrics collection and storage
* **Grafana** - Metrics visualization and dashboards
* **Exporters** - Components that expose metrics from different systems

---

# Problem Statement

Running applications in Kubernetes introduces new operational challenges.

A Kubernetes application may have:

* Multiple containers
* Multiple Pods
* Multiple Services
* Dynamic scaling
* Changing workloads

Without monitoring, engineers cannot easily answer:

* Is the application healthy?
* Are Pods consuming too many resources?
* Is the database overloaded?
* Are users experiencing slow response times?
* When did a failure start?
* What caused the failure?

Monitoring provides visibility into the health and performance of our applications.

---

# Monitoring Architecture

Our monitoring architecture follows the standard Kubernetes observability model:

```
                    Kubernetes Cluster

                         Application
                              |
                              |
                  -------------------------
                  |                       |
                  ▼                       ▼

            Application Metrics      Kubernetes Metrics

                  |                       |
                  ▼                       ▼

          Application Exporter     Kubernetes Exporters

                  |                       |
                  └───────────┬───────────┘
                              |
                              ▼

                        Prometheus

                  Metrics Collection Engine

                              |
                              ▼

                         Grafana

                 Visualization Platform

                              |
                              ▼

                     DevOps Engineer

                 Dashboards & Insights
```

---

# What is Prometheus?

## Overview

Prometheus is an open-source monitoring and alerting platform designed specifically for cloud-native environments.

It was originally developed at SoundCloud and is now part of the Cloud Native Computing Foundation (CNCF).

Prometheus collects numerical data called **metrics** from applications and infrastructure, stores them as time-series data, and allows engineers to query and analyze system behavior.

---

# How Prometheus Works

Prometheus uses a **pull-based monitoring model**.

Instead of applications sending metrics to Prometheus, Prometheus periodically requests metrics from monitored targets.

The process works like this:

```
Prometheus

     |
     |
     | HTTP Request
     |
     ▼

Target System

     |
     |
     | /metrics endpoint
     |
     ▼

Metrics Response

     |
     ▼

Prometheus Storage
```

By default, Prometheus scrapes targets every 15 seconds.

Example:

Prometheus sends:

```
GET http://application-service:8080/metrics
```

The application responds:

```
http_requests_total 2500

cpu_usage 65

memory_usage_bytes 2048000
```

Prometheus stores these values with timestamps.

---

# What are Metrics?

Metrics are numerical measurements that describe the state of a system.

Examples:

## Infrastructure Metrics

```
CPU Usage
Memory Usage
Disk Space
Network Traffic
```

## Kubernetes Metrics

```
Number of Pods
Pod Restarts
Container Status
Deployment Replicas
Node Health
```

## Application Metrics

```
HTTP Requests
Response Time
Error Rate
Active Users
Database Queries
```

---

# Prometheus Architecture Components

## 1. Prometheus Server

The core component responsible for:

* Scraping metrics
* Storing time-series data
* Executing queries
* Evaluating alert rules

---

## 2. Time-Series Database

Prometheus stores metrics together with timestamps.

Example:

```
CPU Usage

10:00 → 35%

10:01 → 42%

10:02 → 60%
```

This allows engineers to analyze trends over time.

---

## 3. PromQL

Prometheus Query Language allows engineers to retrieve and analyze metrics.

Example:

Query CPU usage:

```
container_cpu_usage_seconds_total
```

Find running Pods:

```
kube_pod_status_phase
```

Calculate request rate:

```
rate(http_requests_total[5m])
```

---

# What are Exporters?

Most applications and systems do not expose metrics in Prometheus format.

Exporters solve this problem.

An exporter is a small service that collects metrics from another system and converts them into a format Prometheus understands.

Architecture:

```
System

   |
   |
   ▼

Exporter

   |
   |
   ▼

/metrics endpoint

   |
   |
   ▼

Prometheus
```

---

# Common Prometheus Exporters

## 1. Node Exporter

### Purpose

Collects metrics from Linux servers.

### Monitors:

* CPU
* Memory
* Disk
* Network
* System load

Example metrics:

```
node_cpu_seconds_total

node_memory_available_bytes

node_filesystem_avail_bytes
```

Used for:

* Virtual machines
* Kubernetes nodes
* Bare-metal servers

---

# 2. kube-state-metrics

### Purpose

Collects Kubernetes object information.

It monitors:

* Pods
* Deployments
* Services
* StatefulSets
* Jobs
* Nodes

Example:

```
kube_pod_status_phase

kube_deployment_status_replicas
```

Important:

kube-state-metrics does NOT monitor CPU or memory.

It monitors Kubernetes state.

---

# 3. cAdvisor

### Purpose

Collects container-level metrics.

Monitors:

* Container CPU usage
* Container memory
* Network usage
* Filesystem usage

Example:

```
container_cpu_usage_seconds_total

container_memory_usage_bytes
```

---

# 4. Database Exporters

Prometheus provides exporters for databases.

Examples:

## PostgreSQL Exporter

Monitors:

* Connections
* Transactions
* Query performance
* Locks

## MySQL Exporter

Monitors:

* Queries
* Connections
* Replication
* Buffer usage

## Redis Exporter

Monitors:

* Cache hits
* Cache misses
* Memory usage

---

# Installing Prometheus on Kubernetes

Instead of manually deploying multiple YAML files, we use Helm.

Helm packages Kubernetes applications and simplifies installation.

---

## Add Prometheus Helm Repository

```bash
helm repo add prometheus-community \
https://prometheus-community.github.io/helm-charts


helm repo update
```

---

## Install kube-prometheus-stack

```bash
helm install monitoring \
prometheus-community/kube-prometheus-stack \
--namespace monitoring \
--create-namespace
```

---

# Components Installed

The Helm chart installs:

| Component          | Purpose                     |
| ------------------ | --------------------------- |
| Prometheus         | Collects and stores metrics |
| Grafana            | Visualization               |
| Alertmanager       | Alert notifications         |
| Node Exporter      | Server metrics              |
| kube-state-metrics | Kubernetes metrics          |

---

# Verify Installation

```bash
kubectl get pods -n monitoring
```

Example:

```
prometheus-server Running

grafana Running

alertmanager Running

node-exporter Running
```

---

# What is Grafana?

## Overview

Grafana is an open-source visualization platform used to create dashboards from different data sources.

In our architecture:

* Prometheus collects the data
* Grafana displays the data

Think of:

```
Prometheus = Database

Grafana = Dashboard
```

---

# Grafana Architecture

```
              Prometheus

                  |
                  |
                  ▼

              Grafana

                  |
                  |
        --------------------
        |        |         |
        ▼        ▼         ▼

     Graphs   Charts   Alerts
```

---

# Grafana Features

## Dashboards

Visual representation of system metrics.

Examples:

* Kubernetes Cluster Dashboard
* Node Dashboard
* Application Dashboard
* Database Dashboard

---

## Panels

Individual visualizations.

Examples:

* CPU Graph
* Memory Gauge
* Network Chart
* Request Counter

---

## Data Sources

Grafana supports many data sources:

* Prometheus
* Elasticsearch
* MySQL
* PostgreSQL
* Loki
* InfluxDB

For this project:

```
Grafana → Prometheus
```

---

# Accessing Grafana

Forward Grafana service:

```bash
kubectl port-forward svc/monitoring-grafana \
-n monitoring 3000:80
```

Open:

```
http://localhost:3000
```

Retrieve password:

```bash
kubectl get secret monitoring-grafana \
-n monitoring \
-o jsonpath="{.data.admin-password}" | base64 -d
```

Login:

```
Username:
admin
```

---

# Monitoring Our Three-Tier Application

Our application monitoring covers:

## Frontend

Metrics:

* Availability
* Requests
* Response time

## Backend API

Metrics:

* HTTP requests
* Error rates
* Latency
* Application health

## Database

Metrics:

* Connections
* Query performance
* Resource utilization

## Kubernetes Infrastructure

Metrics:

* Pod status
* CPU usage
* Memory usage
* Restarts
* Node health

---

# Complete Monitoring Workflow

```
Developer deploys application

          |
          ▼

Application runs in Kubernetes

          |
          ▼

Exporters expose metrics

          |
          ▼

Prometheus collects metrics

          |
          ▼

Prometheus stores time-series data

          |
          ▼

Grafana creates dashboards

          |
          ▼

DevOps Engineer monitors system health
```

---

# Project Outcome

At the end of this project, we have implemented a production-style monitoring solution capable of:

✅ Monitoring Kubernetes infrastructure
✅ Tracking application performance
✅ Visualizing system health
✅ Detecting failures quickly
✅ Understanding resource consumption
✅ Building dashboards similar to real production environments

---

# Key Takeaways

1. **Exporters expose metrics**
2. **Prometheus collects and stores metrics**
3. **Grafana visualizes metrics**
4. **Helm simplifies deployment of monitoring tools**
5. **Monitoring is essential for operating production Kubernetes applications**

---

This is the foundation you need before moving into the next topics:

**Alerting with Alertmanager → Centralized Logging with Loki/ELK → Distributed Tracing → Full Observability → Production Kubernetes Operations.**
