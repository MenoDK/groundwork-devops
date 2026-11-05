{{- define "groundwork.name" -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}

{{- define "groundwork.labels" -}}
app.kubernetes.io/name: groundwork
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "groundwork.selector" -}}
app.kubernetes.io/name: groundwork
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
