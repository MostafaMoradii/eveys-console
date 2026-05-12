// Default Alertmanager named templates shipped by the Console.
//
// Alertmanager's built-in templates are email-shaped (subject + plain
// body) and fire identically on every receiver type. When an operator
// configures Telegram, they get an email-style blob — which is the
// symptom that pushed this work in the first place. So we ship one
// template per medium and have each receiver invoke the one that
// matches its channel.
//
// Template name convention:
//   eveys.<medium>.<field>
//
// where <medium> is email / telegram / slack and <field> is the
// Alertmanager receiver field the template populates (subject, html,
// text, message, title). Webhook receivers send raw JSON and don't
// need templates.
//
// Go text/template syntax. Variables come from Alertmanager's
// notification payload (https://prometheus.io/docs/alerting/latest/notifications/):
//
//   .Status            "firing" | "resolved"
//   .Alerts            slice of alerts in this notification
//   .Alerts.Firing     just the firing ones
//   .Alerts.Resolved   just the resolved ones
//   .GroupLabels       labels grouped on (route's group_by)
//   .CommonLabels      labels common to every alert in the group
//   .CommonAnnotations annotations common to every alert in the group
//   .ExternalURL       Alertmanager UI base
//
// Each alert exposes .Labels, .Annotations, .StartsAt, .EndsAt,
// .GeneratorURL (Prometheus query link), .Fingerprint.
//
// Why these are not generated:
//   - The templates are content, not config. They're tuned per medium
//     (HTML for email, terse HTML for Telegram, plain text for Slack
//     fallback) and tweaking them is the operator's prerogative.
//   - Hand-written is easier to review than a builder API and the
//     surface is small.

export interface NamedTemplate {
  /** Template name as referenced by Alertmanager receivers, e.g.
   *  `eveys.email.html`. */
  name: string;
  /** Template body (the bit between `{{ define "name" }}` and
   *  `{{ end }}`). */
  body: string;
}

// --------------------------------------------------------------------
// Email
// --------------------------------------------------------------------

const EMAIL_SUBJECT = `[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}{{ if .CommonLabels.severity }} ({{ .CommonLabels.severity }}){{ end }}`;

const EMAIL_HTML = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1A282F; margin: 0; padding: 24px; background: #F4F4F4;">
    <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <tr>
        <td style="padding: 16px 24px; background: {{ if eq .Status "firing" }}#F04E1F{{ else }}#22C55E{{ end }}; color: #ffffff; font-weight: 600; font-size: 16px;">
          {{ if eq .Status "firing" }}🔥 Firing{{ else }}✅ Resolved{{ end }} · {{ .CommonLabels.alertname }}
          {{ if .CommonLabels.severity }}<span style="font-weight: 400; opacity: 0.85;"> · severity: {{ .CommonLabels.severity }}</span>{{ end }}
        </td>
      </tr>
      <tr>
        <td style="padding: 24px;">
          {{ if .CommonAnnotations.summary }}
          <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5;">{{ .CommonAnnotations.summary }}</p>
          {{ end }}
          {{ if .CommonAnnotations.description }}
          <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #4a5860;">{{ .CommonAnnotations.description }}</p>
          {{ end }}

          {{ range .Alerts }}
          <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin-bottom: 16px; border-left: 3px solid {{ if eq .Status "firing" }}#F04E1F{{ else }}#22C55E{{ end }}; background: #F4F4F4; border-radius: 4px;">
            <tr>
              <td style="padding: 12px 16px; font-size: 13px;">
                {{ if .Annotations.summary }}<div style="font-weight: 600; margin-bottom: 4px;">{{ .Annotations.summary }}</div>{{ end }}
                {{ if .Annotations.description }}<div style="margin-bottom: 8px; color: #4a5860;">{{ .Annotations.description }}</div>{{ end }}
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #4a5860;">
                  {{ range .Labels.SortedPairs }}<div><strong style="color: #1A282F;">{{ .Name }}</strong>: {{ .Value }}</div>{{ end }}
                </div>
                <div style="margin-top: 8px; font-size: 12px; color: #6b7780;">
                  started: {{ .StartsAt.Format "2006-01-02 15:04:05 MST" }}
                  {{ if eq .Status "resolved" }} · resolved: {{ .EndsAt.Format "2006-01-02 15:04:05 MST" }}{{ end }}
                </div>
                {{ if .GeneratorURL }}<div style="margin-top: 8px;"><a href="{{ .GeneratorURL }}" style="color: #F04E1F; text-decoration: none; font-size: 12px;">View in Prometheus →</a></div>{{ end }}
              </td>
            </tr>
          </table>
          {{ end }}

          <p style="margin: 24px 0 0 0; font-size: 12px; color: #6b7780;">
            <a href="{{ .ExternalURL }}" style="color: #F04E1F; text-decoration: none;">Open Alertmanager</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const EMAIL_TEXT = `[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}{{ if .CommonLabels.severity }} (severity: {{ .CommonLabels.severity }}){{ end }}

{{ if .CommonAnnotations.summary }}{{ .CommonAnnotations.summary }}

{{ end }}{{ if .CommonAnnotations.description }}{{ .CommonAnnotations.description }}

{{ end }}{{ range .Alerts }}---
{{ if .Annotations.summary }}{{ .Annotations.summary }}
{{ end }}{{ if .Annotations.description }}{{ .Annotations.description }}
{{ end }}{{ range .Labels.SortedPairs }}  {{ .Name }} = {{ .Value }}
{{ end }}  started: {{ .StartsAt.Format "2006-01-02 15:04:05 MST" }}
{{ if eq .Status "resolved" }}  resolved: {{ .EndsAt.Format "2006-01-02 15:04:05 MST" }}
{{ end }}{{ if .GeneratorURL }}  source: {{ .GeneratorURL }}
{{ end }}
{{ end }}
Open Alertmanager: {{ .ExternalURL }}
`;

// --------------------------------------------------------------------
// Telegram
// --------------------------------------------------------------------
//
// Telegram's `parse_mode: HTML` allows: <b>, <i>, <u>, <s>, <code>,
// <pre>, <a href="…">. Everything else is rejected outright by the
// Bot API (the message just doesn't send). Keep it conservative.
// No <ul>, no <table>, no inline styles.
//
// Telegram messages have a 4096-char hard limit. The template caps
// alert detail at 5 alerts to leave headroom; the rest is rolled up
// into a "(+N more)" line.

const TELEGRAM_MESSAGE = `{{ if eq .Status "firing" }}🔥 <b>FIRING</b>{{ else }}✅ <b>RESOLVED</b>{{ end }} · <b>{{ .CommonLabels.alertname }}</b>
{{ if .CommonLabels.severity }}<i>severity: {{ .CommonLabels.severity }}</i>
{{ end }}
{{ if .CommonAnnotations.summary }}{{ .CommonAnnotations.summary }}
{{ end }}{{ if .CommonAnnotations.description }}<i>{{ .CommonAnnotations.description }}</i>
{{ end }}
{{ $alerts := .Alerts }}{{ $shown := 5 }}{{ if gt (len $alerts) $shown }}{{ $alerts = slice $alerts 0 $shown }}{{ end }}{{ range $alerts }}---
{{ if .Labels.cp_id }}🔌 <code>{{ .Labels.cp_id }}</code>
{{ end }}{{ if .Annotations.summary }}{{ .Annotations.summary }}
{{ end }}{{ if .Labels.instance }}<i>instance:</i> <code>{{ .Labels.instance }}</code>
{{ end }}<i>since:</i> {{ .StartsAt.Format "15:04:05 MST" }}
{{ end }}{{ if gt (len .Alerts) 5 }}
<i>(+{{ sub (len .Alerts) 5 }} more)</i>
{{ end }}
<a href="{{ .ExternalURL }}">Open Alertmanager</a>`;

// --------------------------------------------------------------------
// Slack
// --------------------------------------------------------------------
//
// Slack receives a title + text. Slack's own markdown parser is
// permissive on `text`; we use *bold* and `code` markers. The title
// shows up in notification previews on phone, so we keep it short
// and information-dense.

const SLACK_TITLE = `{{ if eq .Status "firing" }}🔥{{ else }}✅{{ end }} {{ .CommonLabels.alertname }}{{ if .CommonLabels.severity }} · {{ .CommonLabels.severity }}{{ end }}{{ if eq .Status "firing" }} ({{ .Alerts.Firing | len }}){{ end }}`;

const SLACK_TEXT = `{{ if .CommonAnnotations.summary }}{{ .CommonAnnotations.summary }}
{{ end }}{{ if .CommonAnnotations.description }}_{{ .CommonAnnotations.description }}_
{{ end }}
{{ $alerts := .Alerts }}{{ $shown := 5 }}{{ if gt (len $alerts) $shown }}{{ $alerts = slice $alerts 0 $shown }}{{ end }}{{ range $alerts }}• {{ if .Labels.cp_id }}\`{{ .Labels.cp_id }}\` — {{ end }}{{ if .Annotations.summary }}{{ .Annotations.summary }}{{ else }}{{ .Labels.alertname }}{{ end }} _since {{ .StartsAt.Format "15:04 MST" }}_
{{ end }}{{ if gt (len .Alerts) 5 }}_(+{{ sub (len .Alerts) 5 }} more)_
{{ end }}
<{{ .ExternalURL }}|Open Alertmanager>`;

// --------------------------------------------------------------------
// Public surface
// --------------------------------------------------------------------

export const DEFAULT_TEMPLATES: NamedTemplate[] = [
  { name: 'eveys.email.subject', body: EMAIL_SUBJECT },
  { name: 'eveys.email.html', body: EMAIL_HTML },
  { name: 'eveys.email.text', body: EMAIL_TEXT },
  { name: 'eveys.telegram.message', body: TELEGRAM_MESSAGE },
  { name: 'eveys.slack.title', body: SLACK_TITLE },
  { name: 'eveys.slack.text', body: SLACK_TEXT },
];

/** Map from channel type → template names to wire into the receiver.
 *  Webhook receivers don't take a template (raw JSON delivery), so
 *  they're absent here. The renderer in channels-store consults this
 *  to know which fields to emit on each receiver type. */
export const CHANNEL_TEMPLATE_INVOCATIONS = {
  email: {
    headers_subject: 'eveys.email.subject',
    html: 'eveys.email.html',
    text: 'eveys.email.text',
  },
  telegram: {
    message: 'eveys.telegram.message',
  },
  slack: {
    title: 'eveys.slack.title',
    text: 'eveys.slack.text',
  },
} as const;

/** Render the templates file Alertmanager loads. The file is a
 *  sequence of `{{ define "name" }} … {{ end }}` blocks separated by
 *  blank lines. Alertmanager parses it on startup and on /-/reload. */
export function renderTemplatesYaml(templates: NamedTemplate[]): string {
  const header =
    '# Managed by the Console — defaults seeded on first boot.\n' +
    '# Edits via /sys/alerts → Templates (future) or by overwriting\n' +
    '# specific receiver fields on the Channels tab. Direct edits to\n' +
    '# this file may be overwritten on the next Console-driven write.\n\n';
  const body = templates.map((t) => `{{ define "${t.name}" }}${t.body}{{ end }}`).join('\n\n');
  return header + body + '\n';
}
