import { describe, expect, it } from 'vitest';
import { parseDuration } from './TicketTime';

describe('parseDuration', () => {
  it('reads h:mm, minutes and hours', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('45 min')).toBe(45);
    expect(parseDuration('1,5h')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('0:00')).toBeNull();
    expect(parseDuration('25:00')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });
});
