
 "Imagine your CEO says we need to deploy this application for 20 hospitals."

Each hospital needs

* Different database password
* Different domain name
* Different image version
* Different storage size
* Different replica count

Without Helm, they'll have

```
hospital1/
hospital2/
hospital3/
hospital4/
...
```

Each folder contains almost identical YAML files.

Then ask

> "Who wants to maintain 300 YAML files?"

This creates the need for Helm.

Then introduce Helm as

> **Docker Compose for Kubernetes... but much more powerful.**

---

# Part 2 - Helm Architecture

Draw this

```
Helm CLI
     │
     ▼
Chart
 ├── Chart.yaml
 ├── values.yaml
 ├── templates/
 └── charts/
```

Explain every file.

### Chart.yaml

Metadata

```
name
description
version
appVersion
```

---

### values.yaml

This is where users customize deployments.

Example

```
replicaCount: 2

image:
  repository: nginx
  tag: latest

service:
  port: 80

database:
  password: mypassword
```

---

### templates/

Contains all Kubernetes manifests.

Instead of

```
replicas: 2
```

You'll now have

```
replicas: {{ .Values.replicaCount }}
```

---

# Part 3 - Convert Their Existing Project into Helm

This is the exciting part.

Take the application they've already deployed.

Run

```
helm create three-tier-app
```

Show them the generated structure.

Delete everything unnecessary.

Then gradually move

Deployment

↓

Service

↓

ConfigMap

↓

Secret

↓

StatefulSet

↓

PVC

into templates.

---

# Part 4 - Helm Templating (Very Important)

Teach

Variables

```
{{ .Values.image.repository }}
```

Default values

```
{{ default "latest" .Values.image.tag }}
```

Quotes

```
{{ quote .Values.database.password }}
```

Uppercase

```
{{ upper .Values.environment }}
```

Lowercase

```
{{ lower .Values.environment }}
```

Replace

```
{{ replace "-" "_" .Values.appName }}
```

---

Teach Pipelines

```
{{ .Values.name | quote }}
```

---

Teach Indentation

```
nindent

indent

toYaml
```

These are used everywhere.

---

# Part 5 - Named Templates (_helpers.tpl)

Explain why

Instead of writing

```
labels:
  app: nginx
```

inside every file

Create

```
_helpers.tpl
```

Example

```
{{- define "app.labels" }}

app: {{ .Chart.Name }}

release: {{ .Release.Name }}

{{- end }}
```

Then call

```
{{ include "app.labels" . | indent 4 }}
```

Students usually love this because it reduces duplication.

---

# Part 6 - Helm Commands

Teach these in order.

```
helm create
```

```
helm install
```

```
helm list
```

```
helm get values
```

```
helm get manifest
```

```
helm history
```

```
helm status
```

```
helm uninstall
```

---

# Part 7 - Dry Runs

One of the coolest demos.

```
helm install myapp . --dry-run
```

Nothing gets deployed.

Students see generated YAML.

Then

```
helm template .
```

Show them that Helm simply generates Kubernetes manifests.

This removes the "magic."

---

# Part 8 - Multiple Environments

Show

```
values-dev.yaml

values-staging.yaml

values-prod.yaml
```

Deploy

```
helm install app-dev . \
-f values-dev.yaml
```

Then

```
helm install app-prod . \
-f values-prod.yaml
```

This usually creates the "aha!" moment.

---

# Part 9 - Versioning

Teach

```
Chart.yaml

version: 0.1.0

appVersion: 1.0.0
```

Explain

Chart Version

vs

Application Version

Many engineers confuse these.

---

# Part 10 - Helm Upgrade

This is probably the most important real-world lesson.

Deploy version 1

```
image: v1
```

Then

```
helm upgrade
```

Deploy version 2

```
image: v2
```

No YAML editing.

No deleting.

No recreating.

Just

```
helm upgrade myapp .
```

---

# Part 11 - Rollbacks (Students Love This)

Deploy broken version

Then

```
helm history myapp
```

Shows

```
Revision 1

Revision 2

Revision 3
```

Rollback

```
helm rollback myapp 2
```

Application immediately returns.

Now explain

> Helm stores release history.

This is impressive because it's something they'll use in production.

---

# Part 12 - Packaging Charts

```
helm package .
```

Creates

```
three-tier-app-0.1.0.tgz
```

Explain

This is what companies publish.

---

# Part 13 - Helm Repository

Show

```
helm repo add

helm repo list

helm search repo
```

Install something instantly.

Example

```
helm install mysql bitnami/mysql
```

or

```
helm install nginx bitnami/nginx
```

Then explain

Companies rarely write every YAML from scratch.

---

# Part 14 - Dependency Charts

Show

```
dependencies:
```

in

```
Chart.yaml
```

Example

```
Frontend

Backend

Postgres
```

can become

```
Frontend Chart

↓

depends on

↓

Postgres Chart
```

This introduces reusable components.

---

# Part 15 - Helm Hooks (Advanced)

Very impressive topic.

Example

Before deployment

```
Run database migration
```

After deployment

```
Run smoke test
```

These are called Hooks.

```
pre-install

post-install

pre-upgrade

post-upgrade
```

---

# Part 16 - Linting

```
helm lint .
```

Students should never deploy without this.

---

# Part 17 - Production Best Practices

Explain why Secrets should never be committed in plain text.

Introduce

* Helm Secrets
* SOPS
* External Secrets Operator
* External secret managers (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault)

This prepares them for enterprise environments.

---

# Part 18 - Connect Helm to CI/CD

Show how GitHub Actions would deploy using Helm:

```yaml
- name: Deploy

  run: |

    helm upgrade --install \
      myapp ./chart \
      --namespace production \
      --values values-prod.yaml
```

Now they can see the full DevOps workflow:

```
Developer pushes code
        │
        ▼
GitHub Actions
        │
        ▼
Docker Build
        │
        ▼
Push to Registry
        │
        ▼
Helm Upgrade
        │
        ▼
Kubernetes Cluster
```

This ties together Git, Docker, CI/CD, Helm, and Kubernetes into one pipeline.

## Capstone Challenge (30–45 minutes)

End the class with a practical exercise:

> **Convert your existing three-tier application into a production-ready Helm chart.**

Requirements:

* Parameterize image repository and tag.
* Parameterize replica count.
* Parameterize service type and port.
* Parameterize PVC size.
* Parameterize database credentials using values (while discussing why production secrets should come from a secrets manager).
* Create `values-dev.yaml` and `values-prod.yaml`.
* Use `_helpers.tpl` for labels and naming.
* Validate with `helm lint`.
* Preview with `helm template`.
* Install with `helm install`.
* Upgrade the image version with `helm upgrade`.
* Simulate a bad release and recover with `helm rollback`.

### What this prepares them for

By the end of this session, your students will have progressed from writing raw Kubernetes manifests to using the same deployment workflow common in many engineering teams:

* Writing Kubernetes resources
* Packaging applications with Helm
* Managing environment-specific configurations
* Performing zero-downtime upgrades
* Rolling back failed releases
* Integrating Helm into CI/CD pipelines
* Preparing for GitOps tools such as Argo CD or Flux (a natural topic for your next class)

This sequence mirrors how Kubernetes is typically used in production and will give them a strong foundation before you introduce GitOps.
