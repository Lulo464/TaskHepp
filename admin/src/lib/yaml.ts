import type { Entity, Rule } from './types';

const WEBHOOK_URL = 'https://tasks.example.com/api/hooks/ha/8f3c';

const conditionText = (r: Rule) => r.cond + (r.cond2 ? ` ${r.join.toUpperCase()} ${r.cond2}` : '');

/** Home Assistant side: a rest_command plus one automation per enabled rule. */
export function homeAssistantYaml(rules: Rule[]): string {
  const automations = rules
    .filter(r => r.enabled)
    .map(r => [
      `  - alias: "${r.name}"`,
      '    trigger:',
      '      - platform: numeric_state',
      `        entity_id: ${r.entity}`,
      `        # ${conditionText(r)}`,
      '    condition:',
      '      - condition: time',
      `        # ${r.window}`,
      '    action:',
      '      - service: rest_command.tasklog_ticket',
      '        data:',
      `          title: "${r.title}"`,
      `          area: "${r.area}"`,
      `          prio: "${r.prio}"`,
    ].join('\n'));

  return [
    'rest_command:',
    '  tasklog_ticket:',
    `    url: "${WEBHOOK_URL}"`,
    '    method: POST',
    '    headers:',
    '      Authorization: "Bearer !secret tasklog_token"',
    '    payload: >',
    '      {"title": "{{ title }}", "area": "{{ area }}", "prio": "{{ prio }}"}',
    '',
    'automation:',
    ...automations,
    '',
  ].join('\n');
}

/** Tasklog side: connection, all rules and the published entities. */
export function tasklogYaml(rules: Rule[], entities: Entity[]): string {
  const ruleBlocks = rules.map(r => [
    `  - name: ${r.name}`,
    `    when: "${r.entity} ${conditionText(r)}"`,
    `    window: "${r.window}"`,
    `    ticket: { title: "${r.title}", area: ${r.area}, prio: ${r.prio} }`,
    `    dedupe: ${r.dedupe}`,
    `    on_end: ${r.onEnd === 'close' ? 'close' : 'keep_open'}`,
    `    enabled: ${r.enabled}`,
  ].join('\n'));

  return [
    'version: 1',
    'homeassistant:',
    '  url: http://homeassistant.local:8123',
    '  token: !secret ha_token',
    'rules:',
    ...ruleBlocks,
    'publish:',
    ...entities.filter(e => e.enabled).map(e => `  - ${e.id}`),
    '',
  ].join('\n');
}
