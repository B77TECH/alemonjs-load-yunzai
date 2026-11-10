import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrossPlatformGroupId } from '../lib/yunzai/identity.js';
import { createOneBotRuntime } from '../lib/yunzai/adapters/onebot-icqq.js';

function createRuntimeMock(overrides = {}) {
  const apiCalls = [];
  const apiMap = new Map(Object.entries(overrides.api ?? {}));
  const runtime = createOneBotRuntime({
    callApi: async (action, params = {}) => {
      apiCalls.push({ action, params });
      if (apiMap.has(action)) {
        const value = apiMap.get(action);

        return typeof value === 'function' ? value(params) : value;
      }

      return {};
    },
    serializeReply: async msg => [{ type: 'text', data: String(msg) }],
    wrapCompatValue: overrides.wrapCompatValue ?? (value => value),
    safeInt: (value, fallback) => {
      const parsed = Number.parseInt(String(value), 10);

      return Number.isFinite(parsed) ? parsed : fallback;
    },
    resolveMasterFlag: data => data.isMaster ?? data.IsMaster ?? false,
    buildForwardMsgCompat: nodes => ({
      type: 'forward',
      data: 'forward-text',
      file: '',
      id: '',
      resid: '',
      message: nodes,
      messages: nodes,
      __forwardParts: nodes,
      toString: () => 'forward-text'
    })
  });

  return { runtime, apiCalls };
}


test('cross-platform group IDs survive configuration lookup, persistence and proactive sending', async () => {
  const ids = ['411FFF510500D0378EB112E37E7393E9', '411OTHER', 'room@chatroom', '00123', '900719925474099312345'];
  const { runtime, apiCalls } = createRuntimeMock();
  for (const id of ids) {
    const groupId = getCrossPlatformGroupId(id, false);
    assert.equal(groupId, id);
    const config = { [id]: { enable: ['二维码生成'] } };
    assert.deepEqual(config[groupId].enable, ['二维码生成']);
    const saved = JSON.parse(JSON.stringify({ groups: [groupId] }));
    const group = runtime.createOneBotGroupAdapter(saved.groups[0]);
    assert.equal(group.group_id, id);
    await group.sendMsg('scheduled news');
    assert.equal(apiCalls.at(-1).params.group_id, id);
  }
  assert.equal(getCrossPlatformGroupId('ignored', true), 0);
  assert.equal(getCrossPlatformGroupId(undefined, false), '');
});

test('shared group adapter preserves numeric OneBot group IDs', async () => {
  const { runtime, apiCalls } = createRuntimeMock();
  const group = runtime.createOneBotGroupAdapter(123456);
  assert.equal(group.group_id, 123456);
  await group.sendMsg('news');
  assert.equal(apiCalls.at(-1).params.group_id, 123456);
});


test('actual Worker message and notice builders retain the original group ID', () => {
  const source = readFileSync(new URL('../src/yunzai/worker.ts', import.meta.url), 'utf8');
  const names = ['safeInt', 'isMessageEventName', 'resolveMasterFlag', 'buildFallbackNonMessageEvent', 'buildEvent'];
  const functions = names.map(name => {
    const match = source.match(new RegExp(String.raw`^function ${name}\b[\s\S]*?^}`, 'm'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
  const { runtime } = createRuntimeMock();
  const context = vm.createContext({
    getCrossPlatformGroupId,
    Bot: { uin: 1905580325 },
    isOneBotPlatform: platform => platform === 'onebot',
    decorateEvent: event => event,
    makeGroupProxy: id => runtime.createOneBotGroupAdapter(id),
    makeFriendProxy: id => ({ user_id: id }),
    mediaToSegments: () => [],
    detectAtMe: () => false,
    detectAtAll: () => false,
    extractFirstAtTarget: () => undefined,
    EVENT_NOTICE_MAP: {},
    EVENT_REQUEST_MAP: {}
  });
  vm.runInContext(stripTypeScriptTypes(functions, { mode: 'transform' }), context);
  const id = '411FFF510500D0378EB112E37E7393E9';
  const data = { platform: 'qq-bot', botId: '1905580325', userId: '12345', spaceId: id, isPrivate: false, messageText: '#开启资讯推送' };
  for (const eventName of ['message.create', 'guild.member.add']) {
    const event = context.buildEvent({ ...data, eventName }, 'test-event');
    assert.equal(event.group_id, id);
    assert.equal(event.group.group_id, id);
  }
});
