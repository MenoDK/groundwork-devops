import { describe, expect, it } from 'vitest';
import { SCRIPTS, parseOutput } from '../../src/runner.js';

describe('script output', () => {
  it('separates the steps from the machine-readable last line', () => {
    const out = parseOutput(
      0,
      '==> shipping v1\nok verified\nRESULT {"ok":true,"gate":"all","result":"shipped","message":"m","release":"v1","detail":null}\n',
    );
    expect(out.steps).toEqual(['==> shipping v1', 'ok verified']);
    expect(out.result?.gate).toBe('all');
    expect(out.exitCode).toBe(0);
  });

  it('keeps a RESULT line it cannot parse as an ordinary step instead of failing', () => {
    const out = parseOutput(1, 'x boom\nRESULT {not json\n');
    expect(out.result).toBeNull();
    expect(out.steps).toContain('RESULT {not json');
  });

  it('reads the last RESULT line when there are several', () => {
    const out = parseOutput(
      0,
      'RESULT {"ok":false,"gate":"a","result":"r","message":"","release":"","detail":null}\nRESULT {"ok":true,"gate":"b","result":"r","message":"","release":"","detail":null}\n',
    );
    expect(out.result?.gate).toBe('b');
  });

  it('only ever names scripts that exist in ops/', () => {
    expect(SCRIPTS).toContain('deploy.sh');
    expect(SCRIPTS.every((s) => /^[a-z-]+\.sh$/.test(s))).toBe(true);
  });
});
