{{/*
Expand the name of the chart.
*/}}
{{- define "claude-code-insights.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name (63-char DNS limit).
*/}}
{{- define "claude-code-insights.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "claude-code-insights.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "claude-code-insights.labels" -}}
helm.sh/chart: {{ include "claude-code-insights.chart" . }}
{{ include "claude-code-insights.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "claude-code-insights.selectorLabels" -}}
app.kubernetes.io/name: {{ include "claude-code-insights.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Container image reference; empty tag falls back to the chart appVersion.
*/}}
{{- define "claude-code-insights.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/*
Name of the Secret holding secret env values: the user-supplied
existingSecret if set, else the chart-managed one.
*/}}
{{- define "claude-code-insights.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "claude-code-insights.fullname" . }}
{{- end }}
{{- end }}

{{/*
Whether the chart should create its own Secret: only when no existingSecret
is given AND at least one inline secret value is set.
*/}}
{{- define "claude-code-insights.createSecret" -}}
{{- if and (not .Values.secrets.existingSecret) (or .Values.secrets.otelIngestToken .Values.secrets.adminApiKey .Values.secrets.enterpriseAnalyticsKey .Values.secrets.foundryApiKey) -}}
true
{{- end }}
{{- end }}

{{/*
Whether ANY secret source exists (chart-managed or existing) — controls
whether the Deployment wires secretKeyRef env vars at all.
*/}}
{{- define "claude-code-insights.hasSecret" -}}
{{- if or .Values.secrets.existingSecret (include "claude-code-insights.createSecret" .) -}}
true
{{- end }}
{{- end }}
