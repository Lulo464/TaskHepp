import { parseWindow, ruleTemplate } from './conditions.js';

export interface RuleForYaml {
  id: number;
  name: string;
  entity: string;
  cond: string;
  join: 'and' | 'or';
  cond2: string;
  window: string;
  title: string;
  area: string;
  prio: 'normal' | 'high';
  onEnd: 'close' | 'keepOpen';
  dedupe: boolean;
  enabled: boolean;
}

// JSON strings are valid YAML double-quoted scalars.
const s = (v: string) => JSON.stringify(v);

/**
 * Home Assistant package: one rest_command that reports rule events to Tasklog,
 * plus one automation per enabled rule with a start and an end trigger.
 */
export function homeAssistantYaml(rules: RuleForYaml[], webhookUrl: string): string {
  const out: string[] = [
    '# Von Tasklog erzeugt. In configuration.yaml einfügen oder als Package ablegen.',
    '# In secrets.yaml: tasklog_auth: "Bearer <API-Token mit Recht tickets:write>"',
    '',
    'rest_command:',
    '  tasklog_event:',
    `    url: ${s(webhookUrl)}`,
    '    method: POST',
    '    headers:',
    '      Authorization: !secret tasklog_auth',
    '    content_type: "application/json"',
    `    payload: '{"rule": {{ rule }}, "event": "{{ event }}"}'`,
    '',
    'automation tasklog:',
  ];

  const enabled = rules.filter(r => r.enabled);
  if (enabled.length === 0) out.push('  []');

  for (const r of enabled) {
    const parsed = ruleTemplate(r);
    out.push(`  - id: tasklog_rule_${r.id}`, `    alias: ${s('Tasklog: ' + r.name)}`, '    mode: queued');
    if (!parsed) {
      out.push(
        `    # Bedingung nicht automatisch übersetzbar: ${r.entity} ${r.cond}${r.cond2 ? ` ${r.join.toUpperCase()} ${r.cond2}` : ''}`,
        '    # Trigger bitte von Hand ergänzen; die Aktion unten bleibt gleich.',
        '    trigger: []',
      );
    } else {
      out.push(
        '    trigger:',
        '      - platform: template',
        '        id: start',
        `        value_template: ${s(`{{ ${parsed.template} }}`)}`,
        ...(parsed.holdFor ? [`        for: ${s(parsed.holdFor)}`] : []),
        '      - platform: template',
        '        id: end',
        `        value_template: ${s(`{{ not (${parsed.template}) }}`)}`,
      );
    }
    const window = parseWindow(r.window);
    if (window) {
      out.push(
        '    condition:',
        '      - condition: or',
        '        conditions:',
        '          - condition: trigger',
        '            id: end',
        '          - condition: time',
        `            after: ${s(window[0])}`,
        `            before: ${s(window[1])}`,
      );
    }
    out.push(
      '    action:',
      '      - service: rest_command.tasklog_event',
      '        data:',
      `          rule: ${r.id}`,
      '          event: "{{ trigger.id }}"',
    );
  }
  return out.join('\n') + '\n';
}

/** Tasklog's own view of the setup — readable export, same structure as the backup. */
export function tasklogYaml(rules: RuleForYaml[], entities: string[], opts: { haUrl: string; webhookUrl: string }): string {
  const out: string[] = [
    'version: 1',
    'homeassistant:',
    `  url: ${s(opts.haUrl || 'http://homeassistant.local:8123')}`,
    '  token: !secret ha_token',
    `  webhook: ${s(opts.webhookUrl)}`,
    'rules:',
  ];
  if (rules.length === 0) out.push('  []');
  for (const r of rules) {
    out.push(
      `  - name: ${s(r.name)}`,
      `    when: ${s(`${r.entity} ${r.cond}${r.cond2 ? ` ${r.join.toUpperCase()} ${r.cond2}` : ''}`)}`,
      `    window: ${s(r.window)}`,
      `    ticket: { title: ${s(r.title)}, area: ${s(r.area)}, prio: ${r.prio} }`,
      `    dedupe: ${r.dedupe}`,
      `    on_end: ${r.onEnd === 'close' ? 'close' : 'keep_open'}`,
      `    enabled: ${r.enabled}`,
    );
  }
  out.push('publish:', ...(entities.length ? entities.map(e => `  - ${e}`) : ['  []']));
  return out.join('\n') + '\n';
}

/** Home Assistant's entity id for a name: lower case, umlauts to plain letters, everything else to "_". */
export function haSlug(name: string): string {
  return name
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Dashboard card for the Tasklog integration: one to-do list card per area (HA's own "todo-list" card, which
 * ticks off, adds and edits items).
 */
export function dashboardYaml(areas: { name: string }[]): string {
  const lines = [
    '# Dashboard-Karte für die Tasklog-Integration (custom_components/tasklog).',
    '# In Home Assistant: Dashboard bearbeiten → Karte hinzufügen → Manuell → diesen Text einfügen.',
    '# Die Entitäten heißen todo.tasklog_<bereich>; stimmt ein Name nicht, unter Einstellungen → Entitäten nachsehen.',
    'type: vertical-stack',
    'cards:',
  ];
  for (const a of areas) {
    lines.push('  - type: todo-list', `    entity: todo.tasklog_${haSlug(a.name)}`, `    title: ${s(a.name)}`);
  }
  return lines.join('\n') + '\n';
}
