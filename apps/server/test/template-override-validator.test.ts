// Tests for the syntactic check that gates operator-supplied template
// overrides. The intent is to catch obvious typos at submission time
// without running a real Go-template parser.

import { describe, expect, it } from 'vitest';

import {
  TemplateOverrideValidationError,
  validateTemplateOverride,
} from '../src/store/template-override-validator.js';

describe('validateTemplateOverride', () => {
  it('passes through empty / undefined overrides (using default)', () => {
    expect(() => validateTemplateOverride('subject', undefined)).not.toThrow();
    expect(() => validateTemplateOverride('subject', '')).not.toThrow();
  });

  it('accepts plain static text without any template blocks', () => {
    expect(() => validateTemplateOverride('subject', 'Static subject line')).not.toThrow();
  });

  it('accepts an allowlisted root token', () => {
    expect(() =>
      validateTemplateOverride('subject', 'Alert: {{ .CommonLabels.alertname }}'),
    ).not.toThrow();
  });

  it('accepts loop-local tokens inside a range', () => {
    // Inside `range .Alerts`, the scope is an Alert, so `.Labels` /
    // `.Annotations` / `.StartsAt` resolve there. We don't track scope
    // — both root-level and loop-local idents are allowlisted.
    expect(() =>
      validateTemplateOverride(
        'html',
        '{{ range .Alerts }}<p>{{ .Labels.alertname }} @ {{ .StartsAt }}</p>{{ end }}',
      ),
    ).not.toThrow();
  });

  it('rejects a misspelled root', () => {
    expect(() =>
      validateTemplateOverride('subject', 'Alert: {{ .CommonLabel.alertname }}'),
    ).toThrow(TemplateOverrideValidationError);
  });

  it('error carries the field name + list of unknown roots', () => {
    try {
      validateTemplateOverride(
        'html',
        '<h1>{{ .Whatever }}</h1> body: {{ .Bogus.x }} foot: {{ .CommonLabels.alertname }}',
      );
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateOverrideValidationError);
      const e = err as TemplateOverrideValidationError;
      expect(e.field).toBe('html');
      // `.CommonLabels` is allowed; the others aren't. Order doesn't
      // matter and duplicates are collapsed.
      expect(new Set(e.bad)).toEqual(new Set(['.Whatever', '.Bogus']));
    }
  });

  it('does not flag `.Labels.x` outside a range — same loop-local roots are global allowlist', () => {
    // We allow loop-local idents unconditionally; this means a typo
    // like `.Labelx` (missing the final `s`) is the path we WILL
    // catch, but a misuse of `.Labels` outside its scope falls through
    // to Alertmanager. Documented trade-off — false negatives here
    // are worth the false positives we'd see if we tried to track
    // scope without a real parser.
    expect(() =>
      validateTemplateOverride('text', 'top-level {{ .Labels.alertname }}'),
    ).not.toThrow();
    expect(() => validateTemplateOverride('text', 'typo {{ .Labelx.alertname }}')).toThrow(
      TemplateOverrideValidationError,
    );
  });

  it('does not flag struct-field access like `foo.Bar` (not a root token)', () => {
    // The token regex requires a non-identifier character or start-of-
    // string before the leading `.`. A bare struct-field access on a
    // variable doesn't match.
    expect(() =>
      validateTemplateOverride('text', '{{ $a := index .CommonLabels "x" }}{{ $a.Field }}'),
    ).not.toThrow();
  });

  it('handles multiple template blocks in one override', () => {
    expect(() =>
      validateTemplateOverride(
        'html',
        '<p>{{ .Status }}</p><p>{{ .GroupLabels.alertname }}</p><p>{{ .ExternalURL }}</p>',
      ),
    ).not.toThrow();
  });
});
