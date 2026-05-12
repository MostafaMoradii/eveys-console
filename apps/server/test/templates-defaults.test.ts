// Sanity tests for the templates module. We don't try to assert
// Alertmanager would accept the rendered file (that's amtool's
// territory in PR 3) — just that the YAML wrapper is well-formed,
// the named blocks are present, and the template invocation map
// covers the channel types we actually emit invocations for.

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_TEMPLATE_INVOCATIONS,
  DEFAULT_TEMPLATES,
  renderTemplatesYaml,
} from '../src/store/templates-defaults.js';

describe('DEFAULT_TEMPLATES', () => {
  it('ships one body per channel field referenced in CHANNEL_TEMPLATE_INVOCATIONS', () => {
    const names = new Set(DEFAULT_TEMPLATES.map((t) => t.name));
    for (const channelKey of Object.keys(CHANNEL_TEMPLATE_INVOCATIONS)) {
      const inv =
        CHANNEL_TEMPLATE_INVOCATIONS[channelKey as keyof typeof CHANNEL_TEMPLATE_INVOCATIONS];
      for (const tplName of Object.values(inv)) {
        expect(names, `template ${tplName} (from ${channelKey})`).toContain(tplName);
      }
    }
  });

  it('uses the eveys.<medium>.<field> naming convention', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.name).toMatch(/^eveys\.(email|telegram|slack)\.[a-z_]+$/);
    }
  });

  it('every template body references at least one notification field', () => {
    // Smoke check that we didn't ship a literal-only template. Every
    // body should reference one of: .Alerts, .CommonLabels,
    // .CommonAnnotations, .Status, .ExternalURL.
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body).toMatch(/\.(Alerts|CommonLabels|CommonAnnotations|Status|ExternalURL)/);
    }
  });
});

describe('renderTemplatesYaml', () => {
  it('wraps each named template in a define/end block', () => {
    const out = renderTemplatesYaml(DEFAULT_TEMPLATES);
    for (const t of DEFAULT_TEMPLATES) {
      expect(out).toContain(`{{ define "${t.name}" }}`);
    }
    // One define per template. Counting {{ end }} would over-match
    // because the template bodies themselves use {{ if }}…{{ end }}
    // and {{ range }}…{{ end }} internally.
    const defines = out.match(/\{\{ define "/g) ?? [];
    expect(defines).toHaveLength(DEFAULT_TEMPLATES.length);
  });

  it('emits the managed-by-Console header so an SRE knows the file is overwritten', () => {
    const out = renderTemplatesYaml(DEFAULT_TEMPLATES);
    expect(out).toContain('Managed by the Console');
  });

  it('handles an empty template list (header only, no defines)', () => {
    const out = renderTemplatesYaml([]);
    expect(out).toContain('Managed by the Console');
    expect(out).not.toContain('{{ define');
    expect(out).not.toContain('{{ end }}');
  });
});
