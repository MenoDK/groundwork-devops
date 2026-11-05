import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('configuration', () => {
  it('starts with defaults that are local and not production', () => {
    const c = loadConfig({});
    expect(c.production).toBe(false);
    expect(c.lab).toBe(false);
    expect(c.controlPort).toBe(3000);
    expect([...c.allowedHosts]).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('refuses the lab in production, because the lab has no login', () => {
    expect(() => loadConfig({ GW_ENV: 'production', GW_LAB: '1' })).toThrow(ConfigError);
    expect(() => loadConfig({ GW_ENV: 'production' })).not.toThrow();
    expect(() => loadConfig({ GW_ENV: 'development', GW_LAB: 'true' })).not.toThrow();
  });

  it('does not guess when the environment is misspelt', () => {
    expect(() => loadConfig({ GW_ENV: 'prod' })).toThrow(ConfigError);
  });

  it('rejects a port that is not a port', () => {
    expect(() => loadConfig({ GW_CONTROL_PORT: '99999' })).toThrow(ConfigError);
    expect(() => loadConfig({ GW_CONTROL_PORT: 'abc' })).toThrow(ConfigError);
  });

  it('adds only the host names it is told to, in lower case', () => {
    const c = loadConfig({ GW_ALLOWED_HOSTS: ' Demo.Example.Test , ,other.test' });
    expect(c.allowedHosts.has('demo.example.test')).toBe(true);
    expect(c.allowedHosts.has('other.test')).toBe(true);
    expect(c.allowedHosts.size).toBe(5);
  });
});
