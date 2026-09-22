'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BridgeClient, BridgeAuthError, BridgeEntitlementError,
  resolveUrl, DEFAULT_URL,
} = require('./bridge');

function fakeFetch(handler) {
  return async (url, init = {}) => {
    const { status, body } = await handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      async json() { return body; },
    };
  };
}

describe('resolveUrl', () => {
  it('defaults to mesh-app shared backend', () => {
    const prev = process.env.ANCHORTRAILS_BRIDGE_URL;
    delete process.env.ANCHORTRAILS_BRIDGE_URL;
    try {
      assert.equal(resolveUrl(), DEFAULT_URL);
    } finally {
      if (prev !== undefined) process.env.ANCHORTRAILS_BRIDGE_URL = prev;
    }
  });
});

describe('BridgeClient', () => {
  it('sends Bearer on prepare and does not put the token in the result', async () => {
    let seen;
    const client = new BridgeClient({
      baseUrl: 'http://127.0.0.1:8765',
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: { model: 'grok-4.6', tools: [], system: 'Layer M', switch: 'Use grok-4.6' },
        };
      }),
    });
    const out = await client.prepare({ ahead: 'do step 4', session_id: 's1' });
    assert.match(seen.url, /\/api\/agent\/prepare$/);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.parse(seen.init.body).ahead, 'do step 4');
    assert.equal(out.model, 'grok-4.6');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('sessionPlan GETs the Layer M card', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: { ok: true, plan: { cursor: '3/6', playbook: 'develop' }, workspace: { id: 'aozhen' } },
        };
      }),
    });
    const out = await client.sessionPlan({ session_id: 'default' });
    assert.match(seen.url, /\/api\/agent\/plan\?session_id=default$/);
    assert.equal(seen.init.method, 'GET');
    assert.equal(seen.init.headers.Authorization, 'Bearer secret-token');
    assert.equal(out.plan.cursor, '3/6');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('refreshPlan POSTs a goal-first rescore', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: { ok: true, refreshed: true, plan: { cursor: '3/4', do: 'advance the goal' } },
        };
      }),
    });
    const out = await client.refreshPlan({
      session_id: 'default',
      check: { ok: false, errors: 1 },
    });
    assert.match(seen.url, /\/api\/agent\/plan\/refresh$/);
    assert.equal(seen.init.method, 'POST');
    assert.deepEqual(JSON.parse(seen.init.body), {
      session_id: 'default',
      check: { ok: false, errors: 1 },
    });
    assert.equal(out.refreshed, true);
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('mapRefresh POSTs to the bridge and reads a refusal as a state', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: { ok: true, started: true, pid: 7 } };
      }),
    });
    const out = await client.mapRefresh();
    assert.match(seen.url, /\/api\/map\/refresh$/);
    assert.equal(seen.init.method, 'POST');
    assert.equal(out.started, true);
    const refused = new BridgeClient({
      token: 't',
      fetch: fakeFetch(() => ({ status: 503, body: { detail: 'bridge down' } })),
    });
    assert.deepEqual(await refused.mapRefresh(), { ok: false, reason: 'bridge down' });
  });

  it('map asks for the open folder, and mapPlan carries the objective', async () => {
    const seen = [];
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url, init) => { seen.push({ url, init }); return { status: 200, body: { ok: true } }; }),
    });
    await client.map({ repo: 'D:\\code oss' });
    assert.match(seen[0].url, /\/api\/map\?repo=D%3A%5Ccode%20oss$/);
    await client.mapPlan({ repo: 'D:\\x', objective: 'finish the panel' });
    assert.match(seen[1].url, /\/api\/map\/plan$/);
    assert.deepEqual(JSON.parse(seen[1].init.body), { repo: 'D:\\x', objective: 'finish the panel' });
    await client.mapRefresh({ repo: 'D:\\x', subtree: 'src', force: true });
    assert.deepEqual(JSON.parse(seen[2].init.body), { repo: 'D:\\x', subtree: 'src', force: true });
    await client.mapApply({ repo: 'D:\\x' });
    assert.deepEqual(JSON.parse(seen[3].init.body), { repo: 'D:\\x' });
  });

  it('mapApply POSTs the one call that writes code', async () => {
    let seen;
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url, init) => { seen = { url, init }; return { status: 200, body: { ok: true, started: true } }; }),
    });
    assert.equal((await client.mapApply()).started, true);
    assert.match(seen.url, /\/api\/map\/apply$/);
    assert.equal(seen.init.method, 'POST');
  });

  it('sessionPanel GETs the AT bar payload', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: {
            ok: true,
            plan: { cursor: '3/6' },
            nodes: [{ name: 'HomePC', caps: ['vault'] }],
            teams: { configured: false, members: [] },
            vault: { access: 'desktop_vault_status', keys: { vault: true } },
          },
        };
      }),
    });
    const out = await client.sessionPanel();
    assert.match(seen.url, /\/api\/agent\/panel$/);
    assert.equal(seen.init.method, 'GET');
    assert.equal(out.nodes[0].name, 'HomePC');
    assert.equal(out.vault.access, 'desktop_vault_status');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('vaultScan never echoes a secret in the client result', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: { ok: true, imported: ['openrouter_api_key'], skipped: [] } };
      }),
    });
    const out = await client.vaultScan({ apply: true });
    assert.match(seen.url, /\/api\/agent\/vault\/scan$/);
    assert.equal(JSON.parse(seen.init.body).apply, true);
    assert.equal(JSON.parse(seen.init.body).scope, 'computer');
    assert.equal(JSON.parse(seen.init.body).confirmed, false);
    assert.deepEqual(out.imported, ['openrouter_api_key']);
    assert.ok(!JSON.stringify(out).includes('sk-'));
  });

  it('catalog GETs live slugs and never stores a key', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: { vendor: 'anchortrails', slugs: ['grok-4.6'], keys: { util_ai: true, vault: false, env: false } },
        };
      }),
    });
    const out = await client.catalog();
    assert.match(seen.url, /\/api\/agent\/catalog$/);
    assert.equal(seen.init.method, 'GET');
    assert.equal(out.slugs[0], 'grok-4.6');
    assert.equal(out.keys.util_ai, true);
    assert.ok(!JSON.stringify(out).includes('sk-'));
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('drive POSTs ahead and driveNext claims it', async () => {
    const seen = [];
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url, init) => {
        seen.push({ url, method: init.method });
        if (String(url).includes('/drive/next')) {
          return { status: 200, body: { empty: false, id: 'd1', ahead: 'list nodes' } };
        }
        return { status: 200, body: { ok: true, queued: true, id: 'd1', ahead: 'list nodes' } };
      }),
    });
    const queued = await client.drive({ ahead: 'list nodes', source: 'cursor' });
    const next = await client.driveNext(0);
    assert.match(seen[0].url, /\/api\/agent\/drive$/);
    assert.equal(seen[0].method, 'POST');
    assert.match(seen[1].url, /\/api\/agent\/drive\/next\?wait_ms=0$/);
    assert.equal(queued.queued, true);
    assert.equal(next.ahead, 'list nodes');
  });

  it('account GETs status and sign-in never echoes device_token in errors', async () => {
    const seen = [];
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen.push({ url, method: init.method, body: init.body });
        if (String(url).endsWith('/api/account')) {
          return { status: 200, body: { signed_in: false, reason: 'not attached' } };
        }
        if (String(url).includes('/signin/start')) {
          return { status: 200, body: { user_code: 'AT-9K2', verification_url: 'https://anchortrails.com/device', device_token: 'dtok', interval: 3, expires_in: 600 } };
        }
        return { status: 200, body: { status: 'pending' } };
      }),
    });
    const status = await client.account();
    const start = await client.signinStart();
    const poll = await client.signinPoll('dtok');
    assert.match(seen[0].url, /\/api\/account$/);
    assert.equal(seen[0].method, 'GET');
    assert.match(seen[1].url, /\/signin\/start$/);
    assert.match(seen[2].url, /\/signin\/poll$/);
    assert.equal(JSON.parse(seen[2].body).device_token, 'dtok');
    assert.equal(status.signed_in, false);
    assert.equal(start.user_code, 'AT-9K2');
    assert.equal(poll.status, 'pending');
    assert.ok(!JSON.stringify(status).includes('secret-token'));
  });

  it('bindWorkspace POSTs the open folder path', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return {
          status: 200,
          body: { ok: true, workspace: { id: 'aozhen', path: 'D:\\\\aozhen', status: 'created' }, repos: [] },
        };
      }),
    });
    const out = await client.bindWorkspace({ path: 'D:\\\\aozhen' });
    assert.match(seen.url, /\/api\/agent\/workspace$/);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.parse(seen.init.body).path, 'D:\\\\aozhen');
    assert.equal(out.workspace.id, 'aozhen');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('searchModels GETs OpenRouter hits; add and task POST the group', async () => {
    const seen = [];
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen.push({ url, init });
        return {
          status: 200,
          body: { ok: true, hits: [{ id: 'x-ai/grok-4.20', prompt_per_m: 2 }], group: [], tasks: [] },
        };
      }),
    });
    const hits = await client.searchModels({ q: 'grok' });
    assert.match(seen[0].url, /\/api\/agent\/models\?q=grok$/);
    assert.equal(hits.hits[0].prompt_per_m, 2);
    await client.addModel({ id: 'x-ai/grok-4.20' });
    assert.match(seen[1].url, /\/api\/agent\/models\/group$/);
    assert.deepEqual(JSON.parse(seen[1].init.body), { id: 'x-ai/grok-4.20' });
    await client.setTaskModel({ task: 'plan', slug: 'grok-4.20', fallback: 'grok-4.6' });
    await client.pinHop({ node: 'HomePC' });
    assert.match(seen[3].url, /\/api\/agent\/hop$/);
    assert.deepEqual(JSON.parse(seen[3].init.body), { node: 'HomePC' });
    assert.match(seen[2].url, /\/api\/agent\/models\/task$/);
    assert.ok(!JSON.stringify(hits).includes('secret-token'));
  });

  it('complete posts the assign slug', async () => {
    let seen;
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: { skipped: true, slug: 'grok-4.6', model: 'x-ai/grok-4', text: '' } };
      }),
    });
    const out = await client.complete({ model: 'grok-4.6', user: 'hi' });
    assert.match(seen.url, /\/api\/agent\/complete$/);
    assert.equal(JSON.parse(seen.init.body).model, 'grok-4.6');
    assert.equal(out.slug, 'grok-4.6');
  });

  it('invoke retries once with approval_token', async () => {
    const urls = [];
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url) => {
        urls.push(url);
        if (!url.includes('approval_token=')) {
          return { status: 202, body: { approval_required: true, approval_token: 'tok-1' } };
        }
        return { status: 200, body: { ok: true, data: { ran: true } } };
      }),
    });
    const out = await client.invoke('meta_list_pillars', {}, { autoApprove: true });
    assert.equal(urls.length, 2);
    assert.match(urls[1], /approval_token=tok-1/);
    assert.equal(out.data.ran, true);
  });

  it('does not auto-approve mutating tools — MUWT waits for the user', async () => {
    const urls = [];
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch((url) => {
        urls.push(url);
        return { status: 202, body: { approval_required: true, approval_token: 'tok-1' } };
      }),
    });
    const out = await client.invoke('write_text_file', { path: 'x' });
    assert.equal(urls.length, 1);
    assert.equal(out.approval_required, true);
    assert.equal(out.approval_token, 'tok-1');
  });

  it('desktopFrame GETs a JPEG payload without storing it', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: { ok: true, mime: 'image/jpeg', data: 'abc', width: 960 } };
      }),
    });
    const out = await client.desktopFrame();
    assert.match(seen.url, /\/api\/agent\/desktop\/frame$/);
    assert.equal(seen.init.method, 'GET');
    assert.equal(out.mime, 'image/jpeg');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('pickSurface POSTs the dest tile id', async () => {
    let seen;
    const client = new BridgeClient({
      token: 'secret-token',
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return { status: 200, body: { ok: true, surface: 'drive', pack: ['browser_look'] } };
      }),
    });
    const out = await client.pickSurface({ id: 'drive' });
    assert.match(seen.url, /\/api\/agent\/surface$/);
    assert.equal(JSON.parse(seen.init.body).id, 'drive');
    assert.equal(out.surface, 'drive');
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  });

  it('throws BridgeAuthError on 401', async () => {
    const client = new BridgeClient({
      token: 'bad',
      fetch: fakeFetch(() => ({ status: 401, body: { detail: 'invalid bearer token' } })),
    });
    await assert.rejects(() => client.prepare({ ahead: 'x' }), BridgeAuthError);
  });

  it('throws BridgeEntitlementError on 402 and keeps entitlement', async () => {
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch(() => ({
        status: 402,
        body: { error: 'subscription lapsed', entitlement: { state: 'lapsed' } },
      })),
    });
    try {
      await client.invoke('browser_look', {});
      assert.fail('expected 402');
    } catch (e) {
      assert.ok(e instanceof BridgeEntitlementError);
      assert.equal(e.status, 402);
      assert.equal(e.body.entitlement.state, 'lapsed');
      assert.ok(!String(e.message).includes('Bearer'));
    }
  });
});

describe('bridge errors read as text', () => {
  it('flattens an object detail so the message is never [object Object]', async () => {
    const client = new BridgeClient({
      token: 't',
      fetch: fakeFetch(() => ({ status: 422, body: { detail: [{ loc: ['body', 'repo'], msg: 'field required' }] } })),
    });
    const out = await client.mapRefresh({ repo: 'D:\\x' });
    assert.equal(out.ok, false);
    assert.match(out.reason, /field required/);
    assert.doesNotMatch(String(out.reason), /object Object/);
  });
});

describe('the graph below the zones', () => {
  it('mapGraph asks per zone and depth, and reads a refusal as a state', async () => {
    const { BridgeClient } = require('./bridge');
    const calls = [];
    const client = new BridgeClient({ url: 'http://b', token: 't' });
    client._json = async (method, path) => {
      calls.push({ method, path });
      if (path.includes('zone=nope')) return { r: { ok: false, status: 404 }, data: { detail: 'no zone nope' } };
      return { r: { ok: true }, data: { ok: true, depth: path.includes('zone=') ? 2 : 1, zones: {} } };
    };
    const top = await client.mapGraph({ repo: 'D:\\aozhen' });
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].path, '/api/map/graph?repo=D%3A%5Caozhen&depth=1');
    assert.equal(top.depth, 1);
    const deep = await client.mapGraph({ repo: 'D:\\aozhen', zone: 'lib-admin' });
    assert.equal(calls[1].path, '/api/map/graph?repo=D%3A%5Caozhen&zone=lib-admin&depth=2');
    assert.equal(deep.depth, 2);
    const no = await client.mapGraph({ repo: 'D:\\aozhen', zone: 'nope' });
    assert.deepEqual(no, { ok: false, reason: 'no zone nope' });
  });
});
