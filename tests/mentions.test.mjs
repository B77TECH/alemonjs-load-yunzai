import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { extractMentionInfo, buildMentionSegments } from '../lib/yunzai/mentions.js';
import { getCrossPlatformGroupId } from '../lib/yunzai/identity.js';
import { createOneBotRuntime } from '../lib/yunzai/adapters/onebot-icqq.js';

const selfId = 1905580325;
const target = '411FFF510500D0378EB112E37E7393E9';

function sourceFunctions(file, names) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return names.map(name => {
    const match = source.match(new RegExp(String.raw`^function ${name}\b[\s\S]*?^}`, 'm'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
}

function bridge(event) {
  let sent;
  const context = vm.createContext({
    extractMentionInfo,
    manager: { send: message => { sent = JSON.parse(JSON.stringify(message)); } },
    msgEvents: new Map(), pending: new Map(),
    REPLY_MAX_TIMEOUT: 1, REPLY_IDLE_TIMEOUT: 1,
    setTimeout: () => 0, cleanPending() {}, cleanMsgEvent() {},
    useMessage: () => [{}], extractMedia: () => [], isOneBotPlatform: platform => platform === 'onebot'
  });
  vm.runInContext(stripTypeScriptTypes(sourceFunctions('../src/yunzai/bridge.ts', ['extractRawEvent', 'dispatchEventToWorker']), { mode: 'transform' }), context);
  context.dispatchEventToWorker('mention-test', {
    name: 'message.create', Platform: 'qq-bot', BotId: String(selfId),
    GuildId: 'room-X', UserId: '12345', MessageId: 'test', MessageText: '#probe', ...event
  });
  return sent.data;
}

function worker(data) {
  const runtime = createOneBotRuntime({
    callApi: async () => ({}), serializeReply: async () => [], wrapCompatValue: value => value,
    safeInt: (value, fallback) => Number.parseInt(String(value), 10) || fallback,
    resolveMasterFlag: () => false, buildForwardMsgCompat: () => ({})
  });
  const context = vm.createContext({
    Bot: { uin: selfId }, getCrossPlatformGroupId, buildMentionSegments,
    isOneBotPlatform: platform => platform === 'onebot', oneBotRuntime: runtime,
    makeGroupProxy: id => ({ group_id: id }), makeFriendProxy: id => ({ user_id: id }),
    mediaToSegments: () => [], EVENT_NOTICE_MAP: {}, EVENT_REQUEST_MAP: {}
  });
  vm.runInContext(stripTypeScriptTypes(sourceFunctions('../src/yunzai/worker.ts', [
    'safeInt', 'detectAtMe', 'detectAtAll', 'extractFirstAtTarget', 'isMessageEventName',
    'resolveMasterFlag', 'buildFallbackNonMessageEvent', 'buildEvent', 'decorateEvent'
  ]), { mode: 'transform' }), context);
  return context.buildEvent(data, 'mention-test');
}

test('old raw QQ bot/is_you patch survives the actual bridge and Worker IPC path', () => {
  const data = bridge({ value: { mentions: [
    { id: 'BOT_OPENID', bot: true, is_you: true },
    { id: target, username: 'target' }
  ] } });
  assert.equal(data.isAtMe, true);
  const event = worker(data);
  assert.equal(event.atme, true);
  assert.equal(event.atBot, true);
  assert.equal(event.at, target);
  assert.deepEqual(Array.from(event.message.filter(segment => segment.type === 'at'), segment => segment.qq), [selfId, target]);
});

test('standard scoped mentions take precedence over raw global IDs without duplicates', () => {
  const data = bridge({
    IsAtMe: true,
    MessageMentions: [{ UserId: target, SourceUserId: 'global-user', UserName: 'scoped' }],
    value: { mentions: [{ id: 'global-user', username: 'raw' }] }
  });
  assert.deepEqual(data.atUsers, [{ userId: target, userName: 'scoped' }]);
  const event = worker(data);
  assert.equal(event.atBot, true);
  assert.equal(event.at, target);
});

test('explicit IsAtMe is preserved when the adapter removed the bot from text and mentions', () => {
  const event = worker(bridge({ IsAtMe: true, MessageMentions: [], value: {} }));
  assert.equal(event.atme, true);
  assert.equal(event.atBot, true);
  assert.equal(event.at, undefined);
  assert.equal(event.message.filter(segment => segment.type === 'at').length, 1);
});

test('another bot is not mistaken for this bot', () => {
  const event = worker(bridge({ value: { mentions: [{ id: 'OTHER_BOT', bot: true, is_you: false }] } }));
  assert.equal(event.atme, false);
  assert.equal(event.atBot, false);
  assert.equal(event.at, 'OTHER_BOT');
});

test('raw self flag still works when the adapter omits that mention ID', () => {
  const event = worker(bridge({ value: { mentions: [{ bot: true, is_you: true }] } }));
  assert.equal(event.atme, true);
  assert.equal(event.atBot, true);
  assert.equal(event.at, undefined);
});

test('multiple opaque and large mention IDs remain distinct and intact', () => {
  const ids = [target, '411OTHER', '00123', '900719925474099312345'];
  const event = worker(bridge({ MessageMentions: ids.map(UserId => ({ UserId })) }));
  assert.deepEqual(Array.from(event.message.filter(segment => segment.type === 'at'), segment => segment.qq), ids);
});

test('at-all is retained from raw QQ scope and generic OneBot-style segments', () => {
  for (const value of [
    { mentions: [{ scope: 'all' }] },
    { message: [{ type: 'at', data: { qq: 'all' } }] }
  ]) {
    const event = worker(bridge({ value }));
    assert.equal(event.atall, true);
    assert.equal(event.atme, false);
    assert.equal(event.atBot, false);
  }
});

test('malformed mentions do not manufacture undefined or empty user IDs', () => {
  const info = extractMentionInfo({ value: { mentions: [null, {}, { id: null }, { id: '' }] } });
  assert.deepEqual(info, { atUsers: [], isAtMe: false });
  assert.deepEqual(buildMentionSegments(null, selfId), []);
});

test('an all marker is retained alongside standard user mentions without duplicating users', () => {
  const event = worker(bridge({ MessageMentions: [{ UserId: target }], value: { message: [
    { type: 'at', data: { qq: target } }, { type: 'at', data: { qq: 'all' } }
  ] } }));
  assert.equal(event.atall, true);
  assert.deepEqual(Array.from(event.message.filter(segment => segment.type === 'at'), segment => segment.qq), [target, 'all']);
});

test('native OneBot raw message chain, numeric IDs and flags remain authoritative', () => {
  const message = [
    { type: 'at', data: { qq: selfId } },
    { type: 'text', data: { text: '#probe' } },
    { type: 'at', data: { qq: 222 } },
    { type: 'at', data: { qq: 'all' } }
  ];
  const data = bridge({ Platform: 'onebot', value: {
    post_type: 'message', message_type: 'group', self_id: selfId,
    group_id: 123456, user_id: 12345, message_id: 1, message,
    sender: { nickname: 'OneBot user' }
  } });
  const original = JSON.stringify(data.rawEvent);
  // Fallback-only metadata must not inject or duplicate OneBot's raw segments.
  data.atUsers = [{ userId: 'UNRELATED' }];
  data.isAtMe = true;
  const event = worker(data);
  assert.equal(event.atme, true);
  assert.equal(event.atBot, true);
  assert.equal(event.atall, true);
  assert.equal(event.group_id, 123456);
  assert.deepEqual(Array.from(event.message.filter(segment => segment.type === 'at'), segment => segment.qq), [selfId, 222, 'all']);
  assert.equal(JSON.stringify(data.rawEvent), original);
});

test('native OneBot CQ strings and private/group paths ignore conflicting fallback flags', () => {
  for (const kind of ['group', 'private']) {
    const data = bridge({ Platform: 'onebot', GuildId: kind === 'group' ? '123456' : '', value: {
      post_type: 'message', message_type: kind, self_id: selfId, user_id: 12345,
      ...(kind === 'group' ? { group_id: 123456 } : {}),
      message_id: 2, message: '[CQ:at,qq=222] #probe', sender: { nickname: 'OneBot user' }
    } });
    data.isAtMe = true;
    data.atUsers = [{ userId: 'BOT_OPENID', isSelf: true }];
    const event = worker(data);
    assert.equal(event.atme, false);
    assert.equal(event.atBot, false);
    assert.equal(event.isPrivate, kind === 'private');
    assert.deepEqual(Array.from(event.message.filter(segment => segment.type === 'at'), segment => segment.qq), ['222']);
  }
});
