# Secrets Management Guide

This project uses two complementary systems to eliminate hardcoded credentials entirely:

1. **GitHub OIDC** — lets GitHub Actions authenticate to AWS without storing any AWS access keys as GitHub secrets
2. **AWS Secrets Manager + Secrets Store CSI Driver** — stores all runtime secrets in AWS and injects them into Kubernetes pods at startup

---

## Part 1 — GitHub OIDC Authentication

### The Problem It Solves

The traditional approach to CI/CD authentication is to create an IAM user, generate long-lived access keys, and paste them into GitHub Secrets as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. This is risky because:

- Long-lived keys don't expire — a leaked key stays valid until manually rotated
- Keys stored in GitHub Secrets are a high-value target
- There is no audit trail linking a specific pipeline run to a specific AWS action

### How OIDC Works

OIDC (OpenID Connect) replaces static keys with short-lived tokens. When a GitHub Actions job runs, GitHub issues a signed JWT token that proves the identity of the workflow — which repo it's from, which branch, which job. AWS is configured to trust tokens signed by GitHub, and exchanges them for temporary AWS credentials that expire after the job finishes.

```
GitHub Actions job starts
        │
        ▼
GitHub issues a signed JWT token
(contains: repo, branch, job context)
        │
        ▼
Workflow calls: aws-actions/configure-aws-credentials
        │
        ▼
AWS STS verifies the JWT signature against GitHub's OIDC provider
        │
        ▼
AWS returns temporary credentials (valid ~1 hour)
        │
        ▼
Job uses credentials → credentials expire when job ends
```

No keys are stored anywhere. Nothing to rotate. Nothing to leak.

### What Terraform Provisions

Terraform sets up the trust relationship between GitHub and AWS automatically:

**`terraform/main.tf`** creates:

- `aws_iam_openid_connect_provider` — registers GitHub's OIDC provider (`token.actions.githubusercontent.com`) in your AWS account so AWS knows to trust tokens it signs
- `aws_iam_role.github_actions` — an IAM role that GitHub Actions can assume, restricted to only the `johntoby/borderless-items-manager` repo on the `monitoring` branch
- `aws_iam_role_policy.github_actions` — least-privilege permissions attached to that role:
  - ECR: push images to the backend and frontend repositories only
  - EKS: describe the cluster (needed to generate a kubeconfig)
  - Secrets Manager: read and update the app and alertmanager secrets

The trust policy on the role uses two conditions that must both be true before AWS will issue credentials:

```
token.actions.githubusercontent.com:sub = repo:johntoby/borderless-items-manager:ref:refs/heads/monitoring
token.actions.githubusercontent.com:aud = sts.amazonaws.com
```

This means a workflow running from a fork, a different branch, or a different repo cannot assume this role.

### GitHub Repository Setup

After running `terraform apply`, only **one secret** needs to be added to GitHub:

1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add:

| Name | Value |
|---|---|
| `AWS_ROLE_ARN` | Output of `terraform output github_actions_role_arn` |

That's it. No `AWS_ACCESS_KEY_ID`. No `AWS_SECRET_ACCESS_KEY`.

### How It Looks in the Pipeline

In `.github/workflows/ci.yaml`, both the `build-and-push` and `deploy` jobs authenticate like this:

```yaml
permissions:
  id-token: write   # required — allows the job to request an OIDC token
  contents: read

- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: us-east-1
```

The `id-token: write` permission is what allows the job to request the JWT from GitHub. Without it, OIDC authentication will fail silently.

### Verifying It Works

After a successful pipeline run, you can confirm no long-lived keys were used:

```bash
# Check CloudTrail for AssumeRoleWithWebIdentity calls from GitHub
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --region us-east-1
```

---

## Part 2 — AWS Secrets Manager

### The Problem It Solves

Even with OIDC handling CI/CD auth, the application itself still needs credentials at runtime — database username, database password, SMTP password. The naive approach is to put these in Kubernetes Secret manifests and commit them to the repo (even base64-encoded, which is not encryption). AWS Secrets Manager solves this by:

- Storing secrets outside the cluster and outside the repo
- Providing a full audit log of every access via CloudTrail
- Supporting automatic rotation
- Allowing fine-grained IAM policies to control exactly which workloads can read which secrets

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   AWS Secrets Manager                   │
│                                                         │
│  borderless-cluster/app          borderless-cluster/    │
│  ├── DB_USER                     alertmanager           │
│  └── DB_PASSWORD                 └── smtp_password      │
└───────────────────┬─────────────────────────┬───────────┘
                    │ GetSecretValue           │ GetSecretValue
                    │ (IRSA)                   │ (IRSA)
        ┌───────────▼──────────┐   ┌──────────▼──────────┐
        │  Secrets Store CSI   │   │  Secrets Store CSI  │
        │  Driver (borderless  │   │  Driver (monitoring │
        │  namespace)          │   │  namespace)         │
        └───────────┬──────────┘   └──────────┬──────────┘
                    │ syncs into               │ syncs into
        ┌───────────▼──────────┐   ┌──────────▼──────────┐
        │  K8s Secret:         │   │  K8s Secret:        │
        │  borderless-secret   │   │  alertmanager-smtp  │
        └───────────┬──────────┘   └──────────┬──────────┘
                    │ secretKeyRef             │ file mount
        ┌───────────▼──────────┐   ┌──────────▼──────────┐
        │  Backend Pod         │   │  Alertmanager Pod   │
        │  env: DB_USER        │   │  auth_password_file │
        │  env: DB_PASSWORD    │   │                     │
        └──────────────────────┘   └─────────────────────┘
```

### Secrets Stored

| Secret Name | Keys | Used By |
|---|---|---|
| `borderless-cluster/app` | `DB_USER`, `DB_PASSWORD` | Backend pod, PostgreSQL StatefulSet |
| `borderless-cluster/alertmanager` | `smtp_password` | Alertmanager (Gmail SMTP) |

### IRSA — How Pods Get Permission to Read Secrets

IRSA (IAM Roles for Service Accounts) is the same OIDC mechanism as GitHub Actions, but for pods running inside EKS. Each pod is associated with a Kubernetes ServiceAccount, and that ServiceAccount is annotated with an IAM role ARN. When the pod makes an AWS API call, EKS automatically injects temporary credentials for that role.

Terraform provisions:

- `aws_iam_role.csi_secrets` — an IAM role bound specifically to the `borderless-csi-sa` ServiceAccount in the `borderless` namespace
- `aws_iam_role_policy.csi_secrets` — allows only `GetSecretValue` and `DescribeSecret` on the two secrets above, nothing else

The trust condition on the role:

```
system:serviceaccount:borderless:borderless-csi-sa
```

A pod in a different namespace or using a different ServiceAccount cannot assume this role and cannot read these secrets.

### The Secrets Store CSI Driver

The CSI driver is the bridge between AWS Secrets Manager and Kubernetes. It runs as a DaemonSet on every node and watches for pods that mount a `secrets-store.csi.k8s.io` volume. When it sees one, it:

1. Calls AWS Secrets Manager using the pod's IRSA credentials
2. Fetches the secret value
3. Mounts the secret as files inside the pod
4. Optionally syncs the values into a native Kubernetes Secret object (enabled via `syncSecret.enabled=true`)

The sync into a native K8s Secret is what allows the backend to continue using `secretKeyRef` in its env vars — the app code doesn't need to know anything about AWS Secrets Manager.

### Key Files

**`helm/templates/secret.yaml`** — defines the ServiceAccount and SecretProviderClass for the app namespace:

```yaml
# ServiceAccount with IRSA annotation
apiVersion: v1
kind: ServiceAccount
metadata:
  name: borderless-csi-sa
  namespace: borderless
  annotations:
    eks.amazonaws.com/role-arn: <csi_role_arn>

# SecretProviderClass — tells the CSI driver what to fetch and how to sync it
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: borderless-aws-secrets
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "borderless-cluster/app"
        objectType: "secretsmanager"
        jmesPath:
          - path: DB_USER
            objectAlias: DB_USER
          - path: DB_PASSWORD
            objectAlias: DB_PASSWORD
  secretObjects:
    - secretName: borderless-secret   # the K8s Secret that gets created
      type: Opaque
      data:
        - objectName: DB_USER
          key: DB_USER
        - objectName: DB_PASSWORD
          key: DB_PASSWORD
```

**`helm/templates/backend.yaml`** — the backend pod mounts the CSI volume to trigger the sync:

```yaml
spec:
  serviceAccountName: borderless-csi-sa
  volumes:
    - name: secrets-store
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: borderless-aws-secrets
  containers:
    - name: backend
      volumeMounts:
        - name: secrets-store
          mountPath: /mnt/secrets
          readOnly: true
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: borderless-secret   # populated by the CSI driver
              key: DB_USER
```

**`helm/monitoring/alertmanager-secretprovider.yaml`** — same pattern for the monitoring namespace, syncing the SMTP password into `alertmanager-smtp`.

---

## Setup Guide

### Prerequisites

- Terraform >= 1.5.0
- AWS CLI configured with credentials that have permission to create IAM roles, Secrets Manager secrets, and EKS resources
- An existing EKS cluster (or run `terraform apply` to create one)

### Step 1 — Create your tfvars file

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your real values:

```hcl
aws_region         = "us-east-1"
cluster_name       = "borderless-cluster"
node_instance_type = "t3.medium"
github_repo        = "johntoby/borderless-items-manager"
github_branch      = "monitoring"

db_user       = "your-actual-db-username"
db_password   = "your-actual-db-password"
smtp_password = "your-actual-gmail-app-password"
```

Make sure `terraform.tfvars` is gitignored — it should already be, but verify:

```bash
grep "terraform.tfvars" ../.gitignore || echo "terraform.tfvars" >> ../.gitignore
```

### Step 2 — Run Terraform

```bash
terraform init
terraform apply
```

Terraform will create:
- The EKS cluster, VPC, ECR repos
- The two Secrets Manager secrets with your credentials
- The GitHub OIDC provider and IAM role
- The IRSA role for the CSI driver

Note the outputs — you will need `github_actions_role_arn` and `csi_role_arn`:

```bash
terraform output github_actions_role_arn
terraform output csi_role_arn
```

### Step 3 — Add the GitHub Secret

In your GitHub repository go to **Settings → Secrets and variables → Actions** and add:

| Name | Value |
|---|---|
| `AWS_ROLE_ARN` | Value from `terraform output github_actions_role_arn` |

### Step 4 — Push to the monitoring branch

The CI pipeline handles everything else automatically:

1. Installs the Secrets Store CSI driver and AWS provider into `kube-system`
2. Fetches the `csi_role_arn` from AWS and injects it into the Helm deploy
3. Deploys the app — the SecretProviderClass and ServiceAccount are created, the backend pod mounts the CSI volume, and `borderless-secret` is synced from Secrets Manager
4. Deploys the monitoring stack — the alertmanager SMTP secret is synced the same way

```bash
git push origin monitoring
```

### Step 5 — Verify

**Check the secrets exist in AWS:**

```bash
aws secretsmanager get-secret-value \
  --secret-id borderless-cluster/app \
  --region us-east-1 \
  --query SecretString \
  --output text
```

**Check the CSI driver is running:**

```bash
kubectl get pods -n kube-system | grep secrets-store
```

**Check the K8s Secret was synced:**

```bash
kubectl get secret borderless-secret -n borderless
kubectl get secret alertmanager-smtp -n monitoring
```

**Check the backend pod is using the right ServiceAccount:**

```bash
kubectl describe pod -l app=borderless-backend -n borderless | grep "Service Account"
```

**Check the SecretProviderClass status:**

```bash
kubectl describe secretproviderclass borderless-aws-secrets -n borderless
```

---

## Rotating Secrets

To rotate a secret, update it in AWS Secrets Manager — no redeployment needed if rotation is configured. For a manual rotation:

```bash
# Update the secret value
aws secretsmanager put-secret-value \
  --secret-id borderless-cluster/app \
  --secret-string '{"DB_USER":"newuser","DB_PASSWORD":"newpassword"}' \
  --region us-east-1

# Restart the backend to pick up the new value
kubectl rollout restart deployment/borderless-backend -n borderless
```

The CSI driver will fetch the new value on the next pod start.

---

## What Is NOT Stored in This Repo

| Credential | Where It Lives |
|---|---|
| DB username & password | AWS Secrets Manager (`borderless-cluster/app`) |
| Gmail SMTP app password | AWS Secrets Manager (`borderless-cluster/alertmanager`) |
| AWS access keys | Nowhere — OIDC tokens are used instead |
| `terraform.tfvars` | Local only — gitignored |

The only secret stored in GitHub is `AWS_ROLE_ARN`, which is an IAM role ARN — a public identifier, not a credential. It cannot be used to authenticate without a valid OIDC token from a trusted workflow.
