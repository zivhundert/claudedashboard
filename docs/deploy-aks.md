# Deploying to AKS (Helm)

Claude Code Insights is one container: Fastify serves the SPA, the `/api`
backend and the OTLP telemetry receiver (`POST /otel/v1/logs|metrics`) on a
single port, with SQLite on one disk. The Helm chart at
[`deploy/helm/claude-code-insights`](../deploy/helm/claude-code-insights)
encodes the two constraints that shape everything else:

- **Exactly one replica, strategy `Recreate`** — SQLite is single-writer and
  the data disk is a ReadWriteOnce Azure Disk (cannot multi-attach). This is
  hardcoded in the chart, not a value.
- **No dashboard auth** — keep exposure VNet-internal (internal Azure Load
  Balancer or internal ingress), or put SSO in front. Dev laptops must still
  reach the service to push telemetry.

Database migrations run automatically at boot; there is no separate migration
step for installs or upgrades.

## A. Online install (cluster can pull from ACR)

### 1. Build and push the image

Either build in Azure (no local docker needed, always the right arch):

```bash
az acr build --registry <acrName> \
  --image claude-code-insights:1.0.1 \
  --platform linux/amd64 .
```

...or cross-build locally and push (on Apple Silicon the `--platform` flag is
mandatory — AKS node pools are amd64):

```bash
az acr login --name <acrName>
docker buildx build --platform linux/amd64 \
  -t <acrName>.azurecr.io/claude-code-insights:1.0.1 --push .
```

### 2. Let AKS pull from the ACR

```bash
az aks update -g <resourceGroup> -n <clusterName> --attach-acr <acrName>
```

(Alternative: create a pull secret and set `imagePullSecrets` in values.)

### 3. Install

`values.yaml` in the chart documents every knob. A typical production install
with an internal Azure Load Balancer:

```bash
# Keep the token out of Helm history: create the secret yourself...
kubectl create namespace claude-insights
kubectl -n claude-insights create secret generic insights-secrets \
  --from-literal=otel-ingest-token="$(openssl rand -hex 32)"
  # optional extra keys for console/enterprise modes:
  #   --from-literal=admin-api-key=sk-ant-admin... \
  #   --from-literal=enterprise-analytics-key=...

helm install insights deploy/helm/claude-code-insights \
  --namespace claude-insights \
  --set image.repository=<acrName>.azurecr.io/claude-code-insights \
  --set image.tag=1.0.1 \
  --set secrets.existingSecret=insights-secrets \
  --set service.type=LoadBalancer \
  --set service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-internal"=true
```

(`--set secrets.otelIngestToken=<token>` works too — the chart then creates
the Secret — but the value lands in Helm release history.)

**Ingress alternative** (internal ingress controller + DNS + TLS instead of
an LB IP):

```bash
helm install insights deploy/helm/claude-code-insights \
  --namespace claude-insights --create-namespace \
  --set image.repository=<acrName>.azurecr.io/claude-code-insights \
  --set secrets.existingSecret=insights-secrets \
  --set ingress.enabled=true \
  --set ingress.className=nginx-internal \
  --set ingress.host=insights.corp.example.com
```

## B. Air-gapped install

Build a self-contained bundle on a connected machine:

```bash
scripts/build-offline-bundle.sh            # version from package.json
scripts/build-offline-bundle.sh 0.2.0      # or explicit
```

This produces `dist/offline-bundle-<v>.tar.gz` containing the linux/amd64
image tarball, the packaged chart, a starter `values-example.yaml`,
`INSTALL-OFFLINE.md` (transfer → load/push into the private registry → helm
install) and `sha256sums.txt`. Follow `INSTALL-OFFLINE.md` on the other side.

## C. Post-install

### 1. Point dev machines at the server

The release NOTES print the exact endpoint. Update each dev machine's
`managed-settings.json` (full guide: [telemetry-setup.md](telemetry-setup.md)):

```json
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://<internal-lb-ip>/otel"
```

or with ingress + TLS: `"https://insights.corp.example.com/otel"`. No
trailing `/v1/...` — the exporter appends it. If you set an ingest token
(you should), pair it on every sender:

```json
"OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <token>"
```

**Dedicated receiver port (optional).** To expose only the telemetry
receiver to dev laptops and keep the dashboard in-cluster, set
`--set otelPort=4318` (any port other than 8080). The pod then runs the
receiver on its own listener, `/otel/*` disappears from the http port, and
the Service publishes a second port named `otel` with that number. Point
senders at `http://<internal-lb-ip>:4318/otel` and restrict the http port
(80) to the dashboard's audience with your LB rules or a NetworkPolicy. The
Ingress routes only the http port, so with `otelPort` set, senders must use
the Service address, not the ingress hostname.

### 2. Verify ingest

Restart a configured dev machine's Claude Code sessions (env vars are read at
startup), run a few prompts, then check the **Skills & Agents** page header —
the ingest counter ("N events ingested · last event X ago") should climb
within seconds. From a dev machine, `curl -X POST http://<host>/otel/v1/logs
-H 'Content-Type: application/json' -d '{}'` returning `200` (or `401` =
reachable but token missing) proves connectivity.

### 3. Do not seed

`pnpm seed` / demo data is for local development only — never run it against
the production database.

## D. Operations

### Upgrades

```bash
helm upgrade insights deploy/helm/claude-code-insights \
  --namespace claude-insights --reuse-values --set image.tag=<newVersion>
```

Migrations run automatically when the new pod boots. Strategy `Recreate`
means the old pod stops before the new one starts — a brief downtime window
is **by design** (the RWO disk and the SQLite write lock must be released
first). Telemetry senders buffer/retry, so short gaps are harmless.

### Backup & restore

The entire state is one SQLite file on the PVC. Two options:

**Azure Disk snapshot** (no downtime, crash-consistent):

```bash
# find the disk behind the PVC
kubectl -n claude-insights get pv \
  $(kubectl -n claude-insights get pvc insights-claude-code-insights -o jsonpath='{.spec.volumeName}') \
  -o jsonpath='{.spec.csi.volumeHandle}'
# snapshot it
az snapshot create -g <nodeResourceGroup> -n insights-backup-$(date +%F) \
  --source <diskResourceId>
```

Restore: create a disk from the snapshot, create a PV/PVC pointing at it (or
use the CSI VolumeSnapshot API), then install with
`--set persistence.existingClaim=<restoredClaim>`.

**File copy** (clean-consistent — stop the writer first):

```bash
kubectl -n claude-insights scale deploy/insights-claude-code-insights --replicas=0
# run a throwaway pod mounting the PVC, then:
kubectl -n claude-insights cp <helper-pod>:/app/data/dashboard.db ./dashboard-$(date +%F).db
kubectl -n claude-insights scale deploy/insights-claude-code-insights --replicas=1
```

(Copying the `.db` while the app runs risks a torn copy — SQLite may have
WAL/journal files in flight. Scale to 0 first, or use disk snapshots.)

### Scaling

Horizontal scaling is intentionally impossible: SQLite is single-writer and
the Azure Disk is ReadWriteOnce, so a second replica would either fail to
schedule (disk can't attach twice) or corrupt the database. Scale
**vertically** via `resources` in values; the defaults (100m/256Mi requests,
500m/512Mi limits) comfortably handle small/medium orgs.

### TLS

- **Ingress + cert-manager**: set `ingress.enabled=true`, add
  `cert-manager.io/cluster-issuer: <issuer>` to `ingress.annotations` and a
  `tls` block; use an internal issuer (internal CA) for VNet-only hostnames,
  since public ACME can't validate private DNS.
- **Internal CA**: terminate TLS at the internal ingress with a cert from
  your corporate CA. Dev machines must trust that CA or telemetry POSTs will
  fail TLS verification.
- Plain HTTP on a trusted VNet is acceptable for a first rollout; the ingest
  token then travels unencrypted, so treat it as network-scoped.

## E. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Pod `Pending`, event `no persistent volumes available` / `waiting for first consumer` | Wrong or missing `persistence.storageClassName` — check `kubectl get storageclass` (AKS default: `managed-csi`). |
| Pod `Pending` after an upgrade, `Multi-Attach error` | Old node still holds the disk; wait for detach (up to a few minutes) — another reason replicas stay at 1. |
| `CrashLoopBackOff`, log `DATA_SOURCE=console requires ADMIN_API_KEY` | You set `dataSource: console`/`enterprise` without the matching key in the Secret. |
| Permission errors on `/app/data` | The chart runs as uid 1000 with `fsGroup: 1000`; if your storage class ignores fsGroup, check the CSI driver or relax the pod securityContext. |
| Telemetry not arriving | (1) Endpoint wrong — must be `.../otel` with **no** `/v1/logs` suffix, and reachable from dev machines (ClusterIP is not!). (2) Token mismatch — 401s in `kubectl logs`; header format is `Authorization=Bearer <token>`. (3) Sessions not restarted — env vars load at process start; terminals restarted, IDEs fully quit and reopened. See [telemetry-setup.md](telemetry-setup.md#troubleshooting-nothing-arrives). |
| Metrics arrive but usage pages stay empty | Missing `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` on senders — cumulative datapoints are dropped. |
| `exec format error` in pod logs | The image was built for arm64 — rebuild with `--platform linux/amd64`. |
