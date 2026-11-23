import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

function route({ ready = true, accepted = true, name = 'message.create' } = {}) {
  let nextCalls = 0;
  const jobs = [];
  const forwarded = [];
  const context = vm.createContext({
    manager: { isReady: ready },
    oneBotIngressGuard: { accept: () => accepted },
    logger: { debug() {} },
    bindReplyListener() {}, bindDoneListener() {}, bindApiRequestListener() {},
    bindExitListener() {}, bindQueueListener() {}, idCounter: 0, Date,
    getYunzaiEventConcurrency: () => 1,
    workerEventQueue: { setConcurrency() {}, enqueue(id, job) { jobs.push(job); } },
    dispatchEventToWorker: (id, event) => forwarded.push(event)
  });
  const source = readFileSync(new URL('../src/yunzai/bridge.ts', import.meta.url), 'utf8');
  const handler = source.slice(source.lastIndexOf('export default (e:'));
  vm.runInContext(stripTypeScriptTypes(handler.replace('export default', 'globalThis.handler =')), context);
  const event = { name, Platform: 'qq-bot', MessageText: '#qid', value: {} };
  context.handler(event, () => nextCalls++);
  return { nextCalls, jobs, forwarded, event };
}

test('ready loader forwards #qid once and immediately continues external routing', () => {
  const result = route();
  assert.equal(result.nextCalls, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.forwarded.length, 0);
  result.jobs[0]();
  assert.equal(result.forwarded.length, 1);
  assert.equal(result.forwarded[0], result.event);
});

test('unready loader and unnamed events continue without forwarding', () => {
  for (const options of [{ ready: false }, { name: '' }]) {
    const result = route(options);
    assert.equal(result.nextCalls, 1);
    assert.equal(result.jobs.length, 0);
  }
});

test('OneBot echoes and duplicates remain suppressed', () => {
  const result = route({ accepted: false });
  assert.equal(result.nextCalls, 0);
  assert.equal(result.jobs.length, 0);
});
