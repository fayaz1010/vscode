'use strict';
/**
 * Dest AT activity bar — Plan, Nodes, Teams, Vault, Models, Workspace.
 * GET /api/agent/panel. Never render a vault value.
 */

const { sessionId } = require('./workspace');
const { rowsFromPlan } = require('./plan');

const VIEWS = {
  nodes: 'anchortrails.nodes',
  teams: 'anchortrails.teams',
  vault: 'anchortrails.vault',
  models: 'anchortrails.models',
  workspace: 'anchortrails.workspace',
};
const PLAN_VIEW = 'anchortrails.plan';

function emptyRow(label, description) {
  return { kind: 'empty', label, description: description || '' };
}

function rowsFromTasks(tasks) {
  if (!tasks || !tasks.length) return [];
  const rows = [{
    kind: 'head',
    label: 'Clustry tasks',
    description: `${tasks.length} open`,
  }];
  for (const task of tasks) {
    rows.push({
      kind: 'task',
      label: task.title || task.id || 'task',
      description: [task.status, task.assignee].filter(Boolean).join(' · '),
    });
  }
  return rows;
}

function rowsFromPlanView(plan, tasks) {
  return [...rowsFromPlan(plan), ...rowsFromTasks(tasks)];
}

function rowsFromNodes(nodes) {
  if (!nodes || !nodes.length) {
    return [emptyRow('No mesh nodes yet', 'Other machines appear after they join')];
  }
  return nodes.map((node) => ({
    kind: 'node',
    label: node.name || 'node',
    description: (node.caps || []).join(' · '),
  }));
}

function rowsFromTeams(teams) {
  if (!teams || !teams.configured) {
    return [emptyRow('Clustry not configured', 'Teams are Clustry members')];
  }
  const members = teams.members || [];
  if (!members.length) {
    return [emptyRow('No members', teams.cluster ? `cluster ${teams.cluster}` : '')];
  }
  const rows = [{
    kind: 'head',
    label: 'Team',
    description: teams.cluster || '',
  }];
  for (const member of members) {
    rows.push({
      kind: 'member',
      label: member.name || member.id || 'member',
      description: [member.role, member.is_agent ? 'agent' : ''].filter(Boolean).join(' · '),
    });
  }
  return rows;
}

function rowsFromVault(vault) {
  const v = vault || {};
  const keys = v.keys || {};
  const connections = v.connections || [];
  const rows = [
    {
      kind: 'head',
      label: v.initialised ? 'Vault ready' : 'Vault not initialised',
      description: v.this_device || '',
      tooltip: v.rule || 'never desktop_vault_get',
    },
    {
      kind: 'setting',
      label: 'Access',
      description: v.access || 'desktop_vault_status',
    },
    {
      kind: 'setting',
      label: 'Keys on this node',
      description: [
        keys.util_ai ? 'util-ai' : null,
        keys.vault ? 'vault' : null,
        keys.env ? 'env' : null,
      ].filter(Boolean).join(' · ') || 'none',
    },
    {
      kind: 'setting',
      label: 'Entries',
      description: `${v.entries || 0} live · ${v.cold_entries || 0} cold`,
    },
    {
      kind: 'setting',
      label: 'This device',
      description: v.device_enrolled ? 'enrolled' : 'not enrolled',
    },
  ];
  for (const recip of v.recipients || []) {
    rows.push({
      kind: 'recipient',
      label: recip.label || recip.id || 'recipient',
      description: [recip.kind, ...(recip.tiers || [])].filter(Boolean).join(' · '),
    });
  }
  if (v.next_step) {
    rows.push({ kind: 'setting', label: 'Next', description: v.next_step });
  }
  const connected = connections.filter((c) => c.connected);
  if (connected.length) {
    rows.push({
      kind: 'head',
      label: 'Connections via keys',
      description: `${connected.length} connected`,
    });
    for (const row of connected) {
      rows.push({
        kind: 'vault',
        label: row.label || row.id,
        description: (row.via || []).join(' · '),
      });
    }
  }
  return rows;
}

function rowsFromModels(models) {
  const m = models || {};
  const via = (m.via || []).join(' · ') || 'no key';
  const rows = [{
    kind: 'head',
    label: m.default || 'assign()',
    description: m.connected ? via : 'not connected',
    tooltip: m.rule || '',
  }];
  for (const slug of m.slugs || []) {
    rows.push({
      kind: 'model',
      label: slug,
      description: m.connected ? via : 'not connected',
    });
  }
  if (rows.length === 1) {
    rows.push(emptyRow('No slugs', 'catalog.slugs is empty'));
  }
  return rows;
}

function rowsFromWorkspace(ws, skills, actions) {
  const rows = [];
  if (!ws || !(ws.id || ws.path)) {
    rows.push(emptyRow('No folder bound', 'Open a folder — dest registers it'));
  } else {
    rows.push({
      kind: 'workspace',
      label: ws.id || 'workspace',
      description: ws.path || '',
    });
  }
  if (skills && skills.tools && skills.tools.length) {
    rows.push({
      kind: 'setting',
      label: 'Skills',
      description: `${skills.tools.length} · ${skills.rule || 'replay first'}`,
    });
  }
  if (actions && actions.tools && actions.tools.length) {
    rows.push({
      kind: 'setting',
      label: 'Actions',
      description: `${actions.tools.length} · ${actions.rule || 'match then replay'}`,
    });
  }
  return rows;
}

function iconFor(row, vscode) {
  const ThemeIcon = vscode && vscode.ThemeIcon;
  if (!ThemeIcon) return undefined;
  if (row.kind === 'head') return new ThemeIcon('checklist');
  if (row.kind === 'node') return new ThemeIcon('device-desktop');
  if (row.kind === 'member') return new ThemeIcon('organization');
  if (row.kind === 'recipient' || row.kind === 'setting') return new ThemeIcon('lock');
  if (row.kind === 'model') return new ThemeIcon('symbol-misc');
  if (row.kind === 'task') return new ThemeIcon('list-unordered');
  if (row.mark === 'now') return new ThemeIcon('arrow-small-right');
  if (row.mark === 'done') return new ThemeIcon('check');
  if (row.kind === 'empty') return new ThemeIcon('circle-slash');
  return new ThemeIcon('circle-outline');
}

function treeItems(rows, vscode) {
  const TreeItem = vscode && vscode.TreeItem;
  if (!TreeItem) return rows;
  return rows.map((row) => {
    const item = new TreeItem(row.label);
    item.description = row.description || '';
    item.tooltip = row.tooltip || row.description || row.label;
    item.iconPath = iconFor(row, vscode);
    item.contextValue = row.kind;
    return item;
  });
}

function startPanel(client, vscode, extras = {}) {
  let cache = null;
  const emitters = [];

  async function load() {
    if (cache) return cache;
    if (!client || typeof client.sessionPanel !== 'function') {
      cache = {};
      return cache;
    }
    cache = await client.sessionPanel({ session_id: sessionId(vscode) });
    return cache;
  }

  function makeProvider(pickRows) {
    const emitter = vscode.window
      ? new vscode.EventEmitter()
      : { 
          listeners: [],
          event: function(listener) {
            this.listeners.push(listener);
            return {
              dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index > -1) {
                  this.listeners.splice(index, 1);
                }
              }
            };
          },
          fire: function(data) {
            this.listeners.forEach(listener => {
              if (typeof listener === 'function') {
                listener(data);
              }
            });
          },
          dispose: function() {
            this.listeners = [];
          }
        };
    emitters.push(emitter);
    return {
      onDidChangeTreeData: emitter.event,
      getTreeItem(el) { return el; },
      async getChildren() {
        try {
          const data = await load();
          return treeItems(pickRows(data || {}), vscode);
        } catch (err) {
          const item = new vscode.TreeItem('AT panel unavailable');
          item.description = (err && err.message) || 'bridge error';
          return [item];
        }
      },
      fire() {
        if (typeof emitter.fire === 'function') emitter.fire();
      },
      dispose() {
        if (typeof emitter.dispose === 'function') emitter.dispose();
      },
    };
  }

  const providers = {
    nodes: makeProvider((d) => rowsFromNodes(d.nodes)),
    teams: makeProvider((d) => rowsFromTeams(d.teams)),
    vault: makeProvider((d) => rowsFromVault(d.vault)),
    models: makeProvider((d) => rowsFromModels(d.models)),
    workspace: makeProvider((d) => rowsFromWorkspace(d.workspace, d.skills, d.actions)),
  };

  const trees = [];
  if (vscode.window && typeof vscode.window.createTreeView === 'function') {
    for (const [key, id] of Object.entries(VIEWS)) {
      trees.push(vscode.window.createTreeView(id, { treeDataProvider: providers[key] }));
    }
  }

  function refresh(partial) {
    if (partial && cache) cache = { ...cache, ...partial };
    else cache = null;
    for (const p of Object.values(providers)) p.fire();
  }

  const cmds = [];
  if (vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    cmds.push(vscode.commands.registerCommand('anchortrails.plan.refresh', async () => {
      if (client && typeof client.refreshPlan === 'function') {
        try {
          const out = await client.refreshPlan({ session_id: sessionId(vscode) });
          if (out && out.plan) refresh({ plan: out.plan });
          else refresh();
        } catch { refresh(); }
      } else {
        refresh();
      }
      if (typeof extras.onPlanRefresh === 'function') extras.onPlanRefresh();
    }));
    cmds.push(vscode.commands.registerCommand('anchortrails.panel.refresh', () => refresh()));
    cmds.push(vscode.commands.registerCommand('anchortrails.plan.show', () => {
      vscode.commands.executeCommand(`${PLAN_VIEW}.focus`);
    }));
    cmds.push(vscode.commands.registerCommand('anchortrails.panel.show', () => {
      vscode.commands.executeCommand('anchortrails.home.openEditor');
    }));
  }

  return {
    refresh,
    dispose() {
      for (const t of trees) {
        if (t && typeof t.dispose === 'function') t.dispose();
      }
      for (const c of cmds) {
        if (c && typeof c.dispose === 'function') c.dispose();
      }
      for (const p of Object.values(providers)) p.dispose();
      for (const e of emitters) {
        if (e && typeof e.dispose === 'function') e.dispose();
      }
      emitters.length = 0;
    },
  };
}

module.exports = {
  VIEWS,
  PLAN_VIEW,
  rowsFromTasks,
  rowsFromPlanView,
  rowsFromNodes,
  rowsFromTeams,
  rowsFromVault,
  rowsFromModels,
  rowsFromWorkspace,
  startPanel,
};
