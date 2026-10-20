import { describe, expect, it } from 'vitest';
import { parseCondition, parseWindow, ruleTemplate } from '../src/services/conditions.js';
import { homeAssistantYaml } from '../src/services/yaml.js';

describe('parseCondition', () => {
  it('compares numbers numerically', () => {
    expect(parseCondition('sensor.filterdruck', '> 1.8')).toEqual({ template: "states('sensor.filterdruck') | float(0) > 1.8" });
    expect(parseCondition('sensor.t', '<= 5,5')?.template).toBe("states('sensor.t') | float(0) <= 5.5");
  });

  it('compares text states', () => {
    expect(parseCondition('vacuum.robi', '= docked')?.template).toBe("is_state('vacuum.robi', 'docked')");
    expect(parseCondition('vacuum.robi', '!= docked')?.template).toBe("not is_state('vacuum.robi', 'docked')");
    expect(parseCondition('binary_sensor.door', 'on')?.template).toBe("is_state('binary_sensor.door', 'on')");
  });

  it('turns "state > duration" into a hold time', () => {
    expect(parseCondition('binary_sensor.fenster', 'on > 2 h')).toEqual({ template: "is_state('binary_sensor.fenster', 'on')", holdFor: '02:00:00' });
    expect(parseCondition('binary_sensor.fenster', 'off > 90 min')?.holdFor).toBe('01:30:00');
  });

  it('handles calendar lead times', () => {
    expect(parseCondition('calendar.muell', 'in 1 Tag')?.template).toContain('in range(0, 86401)');
  });

  it('escapes quotes and rejects what it cannot translate', () => {
    expect(parseCondition("sensor.x", "= it's")?.template).toBe("is_state('sensor.x', 'it\\'s')");
    expect(parseCondition('sensor.x', '> 2 parsecs')).toBeNull();
    expect(parseCondition('sensor.x', 'wenn es regnet')).toBeNull();
  });
});

describe('ruleTemplate', () => {
  it('joins the extra condition', () => {
    expect(ruleTemplate({ entity: 'sensor.nas_temp', cond: '> 60', join: 'or', cond2: 'sensor.nas_fan = 0' })?.template)
      .toBe("(states('sensor.nas_temp') | float(0) > 60) or (states('sensor.nas_fan') | float(0) == 0)");
  });

  it('fails when the extra condition is malformed', () => {
    expect(ruleTemplate({ entity: 'sensor.a', cond: '> 1', join: 'and', cond2: 'kaputt' })).toBeNull();
  });
});

describe('parseWindow', () => {
  it('ignores the whole day', () => {
    expect(parseWindow('00:00–23:59')).toBeNull();
    expect(parseWindow('7:00-9:30')).toEqual(['07:00:00', '09:30:00']);
  });
});

describe('homeAssistantYaml', () => {
  const rule = { id: 7, name: 'Test "quoted"', entity: 'sensor.a', cond: '> 1', join: 'and' as const, cond2: '', window: '00:00–23:59', title: 'T', area: 'Zuhause', prio: 'normal' as const, onEnd: 'close' as const, dedupe: true, enabled: true };

  it('quotes names safely and only includes enabled rules', () => {
    const yaml = homeAssistantYaml([rule, { ...rule, id: 8, enabled: false }], 'https://x/api/hooks/ha/abc');
    expect(yaml).toContain('alias: "Tasklog: Test \\"quoted\\""');
    expect(yaml).toContain('rule: 7');
    expect(yaml).not.toContain('rule: 8');
  });

  it('leaves a hint instead of a broken trigger', () => {
    const yaml = homeAssistantYaml([{ ...rule, cond: 'irgendwas komisches' }], 'https://x');
    expect(yaml).toContain('nicht automatisch übersetzbar');
    expect(yaml).toContain('trigger: []');
  });
});
