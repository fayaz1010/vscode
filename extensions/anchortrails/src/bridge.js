'use strict';
/**
 * Local AT node client for the Code-OSS extension.
 *
 * Same contract as mesh-app: 127.0.0.1 + Bearer. prepare / complete /
 * invoke. Keys never leave the node. Do not log this.token.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_URL = 'http://127.0.0.1:8765';

class BridgeError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.body = body;
  }
}

class BridgeAuthError extends BridgeError {}
class BridgeEntitlementError extends BridgeError {}

function readTokenFile() {
  try {
    return fs.readFileSync(
      path.join(os.homedir(), '.anchortrails', 'bridge_token'),
      'utf8',
    ).trim();
  } catch {
    return '';
  }
}

function resolveToken(explicit) {
  return (explicit || process.env.ANCHORTRAILS_BRIDGE_TOKEN || readTokenFile() || '').trim();
}

function resolveUrl(explicit) {
  const raw = (explicit || process.env.ANCHORTRAILS_BRIDGE_URL || DEFAULT_URL).trim();
  return raw.replace(/\/$/, '');
}

class BridgeClient {
  constructor(opts = {}) {
    this.baseUrl = resolveUrl(opts.baseUrl);
    this.token = resolveToken(opts.token);
    this.fetchImpl = opts.fetch || globalThis.fetch.bind(globalThis);
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async _json(method, pathname, body) {
    const r = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try {
      data = await r.json();
    } catch {
      data = {};
    }
    // FastAPI puts validation errors and raised details under `detail` as objects or
    // arrays; an Error whose message is an object renders as "[object Object]" and
    // says nothing. Flatten it to text before it becomes a message.
    if (data && typeof data === 'object' && data.detail && typeof data.detail !== 'string') {
      try { data.detail = JSON.stringify(data.detail).slice(0, 600); } catch { data.detail = String(data.detail); }
    }
    if (r.status === 401) {
      throw new BridgeAuthError(data.detail || data.error || 'missing or invalid bearer token', {
        status: 401, body: data,
      });
    }
    if (r.status === 402) {
      throw new BridgeEntitlementError(data.error || data.detail || 'entitlement refused', {
        status: 402, body: data,
      });
    }
    return { r, data };
  }

  async catalog() {
    const { r, data } = await this._json('GET', '/api/agent/catalog');
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async sessionPlan({ session_id } = {}) {
    const q = session_id ? `?session_id=${encodeURIComponent(session_id)}` : '';
    const { r, data } = await this._json('GET', `/api/agent/plan${q}`);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async refreshPlan({ session_id, check, advance } = {}) {
    const body = {};
    if (session_id) body.session_id = session_id;
    if (check) body.check = check;
    if (advance) body.advance = true;
    const { r, data } = await this._json('POST', '/api/agent/plan/refresh', body);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async sessionPanel({ session_id } = {}) {
    const q = session_id ? `?session_id=${encodeURIComponent(session_id)}` : '';
    const { r, data } = await this._json('GET', `/api/agent/panel${q}`);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  // THE CODE MAP. Read-only, behind the same bearer as everything else here:
  // the webview never reads repo-dash's out/ directory itself, the bridge does.
  // A missing map comes back as { ok:false, reason } -- a state, not a throw --
  // so the panel can say "no map yet" instead of painting an error banner.
  async map({ repo } = {}) {
    const q = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    const { r, data } = await this._json('GET', `/api/map${q}`);
    if (!r.ok) return { ok: false, reason: (data && (data.detail || data.error)) || `bridge ${r.status}` };
    return data;
  }

  // Plan the work the map found, for an objective. The objective given here is stored
  // for the project; without one the bridge answers needs_objective and the chat asks.
  async mapPlan({ repo, objective } = {}) {
    const body = {};
    if (repo) body.repo = repo;
    if (objective) body.objective = objective;
    const { r, data } = await this._json('POST', '/api/map/plan', body);
    if (!r.ok) return { ok: false, reason: (data && (data.detail || data.error)) || `bridge ${r.status}` };
    return data;
  }

  // The one write on the map surface: ask the bridge to re-run the mapper it was
  // configured with. Returns at once; progress arrives through map() as
  // overview.meta.status moves from `streaming` to `complete`.
  async mapRefresh({ repo, subtree, force } = {}) {
    const body = {};
    if (repo) body.repo = repo;
    if (subtree) body.subtree = subtree;
    if (force) body.force = true;
    const { r, data } = await this._json('POST', '/api/map/refresh', body);
    if (!r.ok) return { ok: false, reason: (data && (data.detail || data.error)) || `bridge ${r.status}` };
    return data;
  }

  // THE ONE CALL THAT WRITES CODE: run the plan beside the map through repo-dash's
  // runner. Only /run in chat reaches this.
  async mapShip({ repo, prod } = {}) {
    const { r, data } = await this._json('POST', '/api/map/ship', { repo: repo || '', prod: Boolean(prod) });
    if (!r.ok) throw new BridgeError(flat(data.error || data.detail) || r.statusText, { status: r.status, body: data });
    return data;
  }

  async mapApply({ repo } = {}) {
    const { r, data } = await this._json('POST', '/api/map/apply', repo ? { repo } : {});
    if (!r.ok) return { ok: false, reason: (data && (data.detail || data.error)) || `bridge ${r.status}` };
    return data;
  }

  async mapZone(slug) {
    const { r, data } = await this._json('GET', `/api/map/zones/${encodeURIComponent(slug)}`);
    if (!r.ok) return { ok: false, reason: (data && (data.detail || data.error)) || `bridge ${r.status}` };
    return data;
  }

  async health() {
    const { r, data } = await this._json('GET', '/api/health');
    if (data.service !== 'anchortrails' && typeof data.tool_count !== 'number') {
      throw new BridgeError('not an AnchorTrails bridge', { status: r.status, body: data });
    }
    return data;
  }

  async prepare({ ahead, session_id, workspace, attachments, payload_tokens } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/prepare', {
      ahead, session_id, workspace, attachments, payload_tokens,
    });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async searchModels({ q } = {}) {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    const { r, data } = await this._json('GET', `/api/agent/models${query}`);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async addModel({ id, slug } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/models/group', { id, slug });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async pinHop({ node, session_id } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/hop', { node, session_id });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async setTaskModel({ task, slug, fallback } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/models/task', { task, slug, fallback });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async complete(body = {}) {
    const { r, data } = await this._json('POST', '/api/agent/complete', body);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async drive(body = {}) {
    const { r, data } = await this._json('POST', '/api/agent/drive', body);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async driveNext(waitMs = 25000) {
    const q = `?wait_ms=${encodeURIComponent(String(waitMs))}`;
    const { r, data } = await this._json('GET', `/api/agent/drive/next${q}`);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async account() {
    const { r, data } = await this._json('GET', '/api/account');
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async signinStart() {
    const { r, data } = await this._json('POST', '/api/account/signin/start', {});
    if (!r.ok || data.error) {
      throw new BridgeError(data.message || data.error || data.detail || r.statusText, { status: r.status, body: data });
    }
    return data;
  }

  async signinPoll(deviceToken) {
    const { r, data } = await this._json('POST', '/api/account/signin/poll', { device_token: deviceToken });
    if (!r.ok && data.status !== 'error') {
      throw new BridgeError(data.message || data.error || data.detail || r.statusText, { status: r.status, body: data });
    }
    return data;
  }

  async desktopFrame() {
    const { r, data } = await this._json('GET', '/api/agent/desktop/frame');
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async pickSurface({ id, session_id } = {}) {
    const body = { id: id || 'auto' };
    if (session_id) body.session_id = session_id;
    const { r, data } = await this._json('POST', '/api/agent/surface', body);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async bindWorkspace({ path, session_id } = {}) {
    if (!path) return { ok: false, error: 'path required' };
    const body = { path };
    if (session_id) body.session_id = session_id;
    const { r, data } = await this._json('POST', '/api/agent/workspace', body);
    if (!r.ok) {
      throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    }
    return data;
  }

  async vaultScan({ apply = true, roots, scope = 'computer', confirmed = false } = {}) {
    const body = { apply, scope, confirmed };
    if (roots) body.roots = roots;
    const { r, data } = await this._json('POST', '/api/agent/vault/scan', body);
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async vaultTest({ id } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/vault/test', id ? { id } : {});
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async vaultRemove({ id } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/vault/remove', { id });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async vaultSet({ id, value } = {}) {
    const { r, data } = await this._json('POST', '/api/agent/vault/set', { id, value });
    if (!r.ok) throw new BridgeError(data.error || data.detail || r.statusText, { status: r.status, body: data });
    return data;
  }

  async invoke(name, args = {}, { approvalToken, autoApprove = false } = {}) {
    const q = approvalToken ? `?approval_token=${encodeURIComponent(approvalToken)}` : '';
    const { r, data } = await this._json('POST', `/api/invoke/${name}${q}`, args || {});
    if (
      autoApprove
      && data && data.approval_required && data.approval_token && !approvalToken
    ) {
      return this.invoke(name, args, { approvalToken: data.approval_token, autoApprove });
    }
    if (!r.ok && data.ok === false) {
      throw new BridgeError(data.error || r.statusText, { status: r.status, body: data });
    }
    return data;
  }
}

module.exports = {
  BridgeClient,
  BridgeError,
  BridgeAuthError,
  BridgeEntitlementError,
  DEFAULT_URL,
  resolveToken,
  resolveUrl,
  readTokenFile,
};
