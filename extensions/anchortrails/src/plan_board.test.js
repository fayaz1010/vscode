'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VIEW_ID, folderItems, historyItems, planBoardHtml } = require('./plan_board');

const BOARD = {
  folder: [{ workspace_id: 'aozhen', goal: 'Aozhen fashion', cursor: '3/6', playbook: 'develop', steps: 'BUILD [>]' }],
  history: [
    { workspace_id: 'aozhen', goal: 'Aozhen fashion', cursor: '3/6', playbook: 'develop' },
    { workspace_id: 'anchortrails', goal: 'AT dest panel', cursor: '12/12', playbook: 'develop' },
  ],
  live: { playbook: 'develop', cursor: '3/6', goal: 'Aozhen fashion', steps: '1.DESIGN [x] | 3.BUILD [>]' },
  workspace: { id: 'aozhen', path: 'D:\\aozhen' },
};

describe('Plan board tabs', () => {
  it('uses the dest plan view', () => {
    assert.equal(VIEW_ID, 'anchortrails.plan');
  });

  it('defaults the folder tab to the open workspace only', () => {
    assert.deepEqual(folderItems(BOARD).map((r) => r.workspace_id), ['aozhen']);
    assert.deepEqual(historyItems(BOARD).map((r) => r.workspace_id), ['anchortrails']);
  });

  it('does not list a reworded live goal as another card', () => {
    const board = {
      folder: [
        { workspace_id: 'at-muwt-probe', goal: 'build a one-file counter app in this folder', cursor: '1/6' },
        { workspace_id: 'at-muwt-probe', goal: 'build a one-file counter app in this folder: index.html with plus and minus buttons. Do not continue leftover Aozhen fashion BUILD.', cursor: '1/6' },
      ],
      history: [
        { workspace_id: 'at-muwt-probe', goal: 'build a one-file counter app in this folder: index.html with plus and minus buttons. Do not continue leftover Aozhen fashion BUILD.', cursor: '1/6' },
        { workspace_id: 'aozhen', goal: 'Add products to Aozhen', cursor: '3/6' },
      ],
      live: { goal: 'build a one-file counter app in this folder', cursor: '1/6', playbook: 'develop' },
      workspace: { id: 'at-muwt-probe' },
    };
    assert.deepEqual(historyItems(board, board.workspace, board.live).map((r) => r.workspace_id), ['aozhen']);
    const html = planBoardHtml({ task_board: board, workspace: board.workspace }, 'history');
    assert.match(html, /Add products to Aozhen/);
    assert.doesNotMatch(html.split('id="history"')[1] || '', /one-file counter/);
  });

  it('paints the live Layer M card when the folder list is still empty', () => {
    const liveOnly = {
      folder: [],
      history: [],
      live: { playbook: 'develop', cursor: '3/6', goal: 'Aozhen fashion', steps: 'BUILD [>]' },
      workspace: { id: 'aozhen', path: 'D:\\aozhen' },
    };
    assert.equal(folderItems(liveOnly, liveOnly.workspace)[0].goal, 'Aozhen fashion');
    const html = planBoardHtml({ task_board: liveOnly, workspace: liveOnly.workspace }, 'plan');
    assert.match(html, /Aozhen fashion/);
    assert.doesNotMatch(html, /No plan for this folder yet/);
  });

  it('renders Plan first with live checkbox states', () => {
    const folder = planBoardHtml({ task_board: BOARD, workspace: BOARD.workspace, tasks: [] }, 'plan');
    assert.match(folder, />Plan</);
    assert.match(folder, /History/);
    assert.match(folder, /id="plan" class="pane on"/);
    assert.match(folder, /Aozhen fashion/);
    assert.match(folder, /class="step now seedable"/);
    assert.match(folder, /<h3>Stack<\/h3>/);
    assert.match(folder, /Languages/);
    const history = planBoardHtml({ task_board: BOARD, workspace: BOARD.workspace }, 'history');
    assert.match(history, /id="history" class="pane on"/);
    assert.match(history, /AT dest panel/);
    assert.match(history, /Done on other plans/);
    assert.doesNotMatch(history.split('id="history"')[1] || '', /Aozhen fashion/);
  });
});
