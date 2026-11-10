import assert from 'node:assert/strict';
import test from 'node:test';
import { installConfigCompatibility } from '../lib/yunzai/config-compat.js';

const groupId = '411FFF510500D0378EB112E37E7393E9';
const botId = 1905580325;
const noWarning = message => assert.fail(message);

test('TRSS retains both IDs and native configuration override precedence', () => {
  const config = {
    default: { enable: ['__deny__'], disable: [] },
    [`${botId}:default`]: { onlyReplyAt: 1 },
    [groupId]: { enable: ['喵喵:角色面板'] },
    [`${botId}:${groupId}`]: { disable: ['喵喵:戳一戳'] }
  };
  const cfg = {
    getGroup(bot = '', group = '') {
      return { ...config.default, ...config[`${bot}:default`], ...config[group], ...config[`${bot}:${group}`] };
    }
  };
  const native = cfg.getGroup;
  assert.equal(native.length, 0);
  assert.equal(installConfigCompatibility(cfg, 'trss', noWarning), true);
  assert.equal(cfg.getGroup, native);
  assert.deepEqual(cfg.getGroup(botId, groupId), {
    enable: ['喵喵:角色面板'], disable: ['喵喵:戳一戳'], onlyReplyAt: 1
  });
  assert.deepEqual(cfg.getGroup(botId, 'another-group').enable, ['__deny__']);
});

for (const variant of ['miao', 'yunzai']) {
  test(`${variant}: legacy single-group API accepts both call styles without losing context`, () => {
    const cfg = {
      groups: { [groupId]: { enable: ['喵喵:角色面板'] } },
      getGroup(group = '') { return this.groups[group] ?? {}; }
    };
    assert.equal(cfg.getGroup.length, 0);
    installConfigCompatibility(cfg, variant, noWarning);
    assert.deepEqual(cfg.getGroup(groupId), cfg.groups[groupId]);
    assert.deepEqual(cfg.getGroup(botId, groupId), cfg.groups[groupId]);
    const adapted = cfg.getGroup;
    installConfigCompatibility(cfg, variant, noWarning);
    assert.equal(cfg.getGroup, adapted);
    assert.deepEqual(cfg.getGroup(botId, groupId), cfg.groups[groupId]);
    assert.deepEqual(cfg.getGroup(), {});
    assert.deepEqual(cfg.getGroup(botId, undefined), {});
  });
}

test('unknown forks retain their original API and report the unsupported adaptation', () => {
  const cfg = { getGroup: (...args) => args };
  const native = cfg.getGroup;
  const warnings = [];
  assert.equal(installConfigCompatibility(cfg, 'unknown', message => warnings.push(message)), false);
  assert.equal(cfg.getGroup, native);
  assert.deepEqual(cfg.getGroup(botId, groupId), [botId, groupId]);
  assert.equal(warnings.length, 1);
});

test('read-only and missing APIs do not crash Worker startup', () => {
  const cfg = Object.freeze({ getGroup: group => group });
  const warnings = [];
  assert.equal(installConfigCompatibility(cfg, 'miao', message => warnings.push(message)), false);
  assert.equal(cfg.getGroup(groupId), groupId);
  assert.equal(warnings.length, 1);
  assert.equal(installConfigCompatibility(null, 'trss', noWarning), false);
  assert.equal(installConfigCompatibility({}, 'miao', noWarning), false);
});
