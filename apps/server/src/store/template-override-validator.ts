// Server-side syntactic check for operator-supplied template overrides
// on the Channels form (subject / html / text / message). The intent is
// not full Go-template parsing — that would either embed `go` or carry
// a JS port — but to catch obvious typos at submission time:
//
//   { "subject": "Alert: {{ .CommonLabel.alertname }}" }
//                          ^^^^^^^^^^^ no such root field
//
// The check walks every `{{ … }}` block, pulls out any token of shape
// `.Identifier`, and rejects the override if any token's first segment
// isn't on the closed allowlist. Sub-paths under an allowed root
// (`.CommonLabels.alertname`, `.GroupLabels.cluster`) are always fine —
// Alertmanager itself decides whether the sub-key exists at delivery
// time, and that's the right place for it.
//
// Functions / pipes / `if` / `range` / `with` / quoted literals all
// pass through untouched — we only inspect bare `.Identifier` roots,
// because those are what an operator mistypes.

const ALLOWED_ROOTS = new Set<string>([
  // Alertmanager's notification-template root scope. Mirrors what the
  // managed default templates already use. New entries here need to
  // (a) actually exist in Alertmanager and (b) be safe to expose to
  // an operator's text without further escaping.
  '.Alerts',
  '.CommonLabels',
  '.CommonAnnotations',
  '.GroupLabels',
  '.Status',
  '.ExternalURL',
  '.Receiver',
  // `.GroupKey` rarely appears in operator-authored templates but is
  // part of the standard scope and harmless to allow.
  '.GroupKey',
  // Loop-local — when an operator writes `{{ range .Alerts }}…{{ .Labels.alertname }}{{ end }}`
  // the `.Labels` / `.Annotations` / `.Status` / `.StartsAt` tokens
  // resolve against an *Alert* not the root scope. We don't track
  // scope here (would need a parser), so allow the loop-local roots
  // unconditionally. False positives on misspelled root fields are
  // worth the false negatives we'd see if we forbade them.
  '.Labels',
  '.Annotations',
  '.StartsAt',
  '.EndsAt',
  '.Fingerprint',
  '.GeneratorURL',
]);

export class TemplateOverrideValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly bad: readonly string[],
  ) {
    const list = bad.map((b) => `\`${b}\``).join(', ');
    super(
      `template override \`${field}\` references unknown helper(s): ${list}. Allowed roots: ` +
        [...ALLOWED_ROOTS].map((r) => `\`${r}\``).join(', '),
    );
    this.name = 'TemplateOverrideValidationError';
  }
}

/** Inspect `value` and throw if it references a `.Identifier` token
 *  whose first segment isn't allowlisted. Empty / undefined values pass
 *  (the receiver will fall back to the managed template). `field` is
 *  used purely for the error message; pass the form field name. */
export function validateTemplateOverride(field: string, value: string | undefined): void {
  if (!value) return;

  // Walk `{{ … }}` blocks. The regex captures the inner body verbatim;
  // we then look for `.<Ident>(.…)*` tokens inside.
  const blockRe = /\{\{([\s\S]*?)\}\}/g;
  const bad: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(value)) !== null) {
    const inner = match[1];
    if (inner === undefined) continue;

    // Token shape: a literal dot followed by an identifier and zero or
    // more `.Identifier` sub-segments. The leading boundary is `\b`
    // OR start-of-string OR a character that can't be part of an
    // identifier (so `$.Foo` and `.Foo` both match, but
    // `foo.Bar` — a struct-field access — doesn't).
    const tokenRe = /(?:^|[^A-Za-z0-9_])\.([A-Z][A-Za-z0-9_]*)/g;
    let tokMatch: RegExpExecArray | null;
    while ((tokMatch = tokenRe.exec(inner)) !== null) {
      const root = `.${tokMatch[1]}`;
      if (!ALLOWED_ROOTS.has(root)) {
        bad.push(root);
      }
    }
  }

  if (bad.length > 0) {
    throw new TemplateOverrideValidationError(field, Array.from(new Set(bad)));
  }
}

export const _ALLOWED_ROOTS_FOR_TESTS: ReadonlySet<string> = ALLOWED_ROOTS;
