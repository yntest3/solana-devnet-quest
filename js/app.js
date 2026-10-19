import {
  assertDevnet,
  createConnection,
  errorMessage,
  escapeHtml,
  formatSol,
  getRpcEndpoint,
  parsePublicKey,
  parseSolToLamports,
  setRpcEndpoint,
  web3,
} from './solana.js';
import { WalletManager } from './wallet.js';
import { executeTransfer, initialSteps, STEP_LABELS, STEP_ORDER } from './transfer.js';
import { fetchTransferHistory, mergeHistoryItems } from './history.js';
import {
  defaultQuests,
  loadProgress,
  loadQuests,
  newQuestId,
  randomAddress,
  rankFor,
  saveProgress,
  saveQuests,
  totalXp,
  validateQuest,
} from './quests.js';
import * as views from './views.js';

const $ = (sel) => document.querySelector(sel);
const MODE_KEY = 'sol-quest:mode';
const STATUS_POLL_MS = 4000;

const endpoint = getRpcEndpoint();
const connection = createConnection(endpoint);
const wallet = new WalletManager();

const emptyHistory = () => ({
  items: [],
  tab: 'sent',
  loading: false,
  loadedOnce: false,
  error: null,
  failed: new Set(),
  cursor: undefined,
});

const state = {
  network: { status: 'checking' },
  balance: null,
  airdrop: { state: 'idle', msg: '' },
  mode: localStorage.getItem(MODE_KEY) === 'transfer' ? 'transfer' : 'quest',
  /** 実行中/直近の送金 { context: 'quest'|'transfer', questId?, running, steps, logs, signature, outcome } */
  run: null,
  quests: loadQuests(),
  progress: {},
  /** 達成記録シグネチャのオンチェーン検証結果 */
  verification: {},
  questError: null,
  transferError: null,
  /** { type: 'wallet' } | { type: 'editor', quest, isNew } | { type: 'clear', quest, signature, rankUp, allCleared } */
  modal: null,
  history: emptyHistory(),
};

/** ウォレット切替時に古い非同期処理の結果を捨てるための世代番号 */
let session = 0;
let accountSubId = null;
let historyTimer = null;

const owner = () => wallet.publicKey?.toBase58() ?? null;
const busy = () => !!state.run?.running;

// ---------------------------------------------------------------- 描画

function render() {
  $('#header-wallet').innerHTML = views.headerWalletHtml(wallet);
  $('#rpc-line').innerHTML = `RPC: <code>${escapeHtml(endpoint)}</code>
    ${state.network.status === 'checking' ? '<span class="muted">（ネットワーク確認中…）</span>' : ''}
    ${state.network.status === 'ok' ? '<span class="ok">✔ Devnet を確認済み</span>' : ''}
    <button type="button" class="link-btn" data-action="change-rpc">変更</button>`;
  $('#network-error').innerHTML =
    state.network.status === 'error' ? `<div class="alert error">${escapeHtml(state.network.message)}</div>` : '';

  const ready = state.network.status === 'ok';
  $('#connect-prompt').hidden = !ready || wallet.connected;
  $('#connected').hidden = !ready || !wallet.connected;
  if (!ready || !wallet.connected) return;

  $('#wallet-panel').innerHTML = views.walletPanelHtml({
    publicKey: wallet.publicKey,
    walletName: wallet.current?.name,
    balance: state.balance,
    airdrop: state.airdrop,
  });

  document.querySelectorAll('[data-action="mode"]').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#quest-view').hidden = state.mode !== 'quest';
  $('#transfer-view').hidden = state.mode !== 'transfer';

  renderQuests();
  renderTransferForm();
  renderHistory();
  renderFlows();
}

function questStatus(quest, index) {
  if (state.progress[quest.id]) return 'achieved';
  if (state.run?.context === 'quest' && state.run.questId === quest.id) {
    if (state.run.running) return 'running';
    if (state.run.outcome === 'error') return 'failed';
  }
  const locked = state.quests.slice(0, index).some((q) => !state.progress[q.id]);
  return locked ? 'locked' : 'available';
}

function renderQuests() {
  const activeQuestId = state.run?.running && state.run.context === 'quest' ? state.run.questId : null;
  $('#quest-progress').innerHTML = views.questProgressHtml(state.quests, state.progress, activeQuestId);
  const activeKey = state.run && STEP_ORDER.find((k) => state.run.steps[k].status === 'active');
  $('#quest-list').innerHTML = state.quests
    .map((quest, index) => {
      const record = state.progress[quest.id];
      return views.questCardHtml({
        quest,
        index,
        status: questStatus(quest, index),
        record,
        verification: record ? state.verification[record.signature] : undefined,
        currentStep: activeKey ? STEP_LABELS[activeKey].title : undefined,
        busy: busy(),
      });
    })
    .join('');
  $('#quest-error').innerHTML = state.questError ? `<div class="alert error">${escapeHtml(state.questError)}</div>` : '';
  document.querySelectorAll('[data-quest-toolbar] button').forEach((b) => (b.disabled = busy()));
}

function renderTransferForm() {
  const form = $('#transfer-form');
  if (!form) return;
  form.querySelectorAll('input, button').forEach((el) => (el.disabled = busy()));
  $('#transfer-submit').textContent = busy() && state.run.context === 'transfer' ? '処理中…' : '送金する';
  $('#form-balance').textContent = state.balance === null ? '' : `　残高: ${formatSol(state.balance)} SOL`;
  $('#transfer-error').innerHTML = state.transferError
    ? `<div class="alert error">${escapeHtml(state.transferError)}</div>`
    : '';
}

function renderHistory() {
  $('#history').innerHTML = views.historyHtml(state.history, owner());
}

/** 送金フロー表示を、対応する場所（自由送金フォーム下 or 該当クエストカード内）に描画 */
function renderFlows() {
  const run = state.run;
  const slotKey = run ? (run.context === 'quest' ? `quest:${run.questId}` : 'transfer') : null;
  document.querySelectorAll('[data-flow-slot]').forEach((slot) => {
    if (slot.dataset.flowSlot !== slotKey) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = views.flowHtml(run, {
      title: run.context === 'quest' ? 'クエスト送金の進捗' : '送金処理の進捗',
      successMessage: run.context === 'quest' ? 'クエスト達成！送金が確定しました 🎉' : '送金が確定しました 🎉',
    });
    const log = slot.querySelector('[data-log]');
    if (log) log.scrollTop = log.scrollHeight;
  });
}

/** 実行中ステップの経過時間だけを軽量に更新（ボタン等を作り直さない） */
function tickElapsed() {
  document.querySelectorAll('[data-elapsed-start]').forEach((el) => {
    el.textContent = `${((Date.now() - Number(el.dataset.elapsedStart)) / 1000).toFixed(1)}s`;
  });
}

function renderModal() {
  const root = $('#modal-root');
  const m = state.modal;
  if (!m) {
    root.innerHTML = '';
    return;
  }
  if (m.type === 'wallet') root.innerHTML = views.walletModalHtml(wallet.wallets);
  if (m.type === 'editor') root.innerHTML = views.questEditorModalHtml(m.quest, m.isNew);
  if (m.type === 'clear') root.innerHTML = views.clearModalHtml(m);
  root.querySelector('[autofocus], input')?.focus();
}

function openModal(modal) {
  state.modal = modal;
  renderModal();
}

function closeModal() {
  state.modal = null;
  renderModal();
}

// ---------------------------------------------------------------- データ取得

async function refreshBalance() {
  const s = session;
  if (!wallet.publicKey) return;
  try {
    const balance = await connection.getBalance(wallet.publicKey, 'confirmed');
    if (s !== session) return;
    state.balance = balance;
    render();
  } catch {
    /* 次回の更新に任せる */
  }
}

async function loadHistory({ more = false } = {}) {
  const s = session;
  const pk = wallet.publicKey;
  const h = state.history;
  if (!pk || h.loading || (more && !h.cursor)) return;
  h.loading = true;
  h.error = null;
  renderHistory();
  try {
    const page = await fetchTransferHistory(connection, pk, more ? { before: h.cursor } : {});
    if (s !== session) return;
    h.items = mergeHistoryItems(h.items, page.items);
    page.fetched.forEach((sig) => h.failed.delete(sig));
    page.failed.forEach((sig) => h.failed.add(sig));
    if (more || !h.loadedOnce) h.cursor = page.before;
    h.loadedOnce = true;
  } catch (e) {
    if (s === session) h.error = errorMessage(e);
  } finally {
    if (s === session) {
      h.loading = false;
      renderHistory();
    }
  }
}

/** 送受信を検知したときなど、短時間に重なる更新要求をまとめる */
function scheduleHistoryRefresh() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => loadHistory(), 800);
}

/** Finalized になっていない履歴の状態を定期的に更新 */
async function pollPendingStatuses() {
  const s = session;
  const sigs = [
    ...new Set(state.history.items.filter((i) => i.success && i.confirmationStatus !== 'finalized').map((i) => i.signature)),
  ];
  if (sigs.length === 0) return;
  try {
    const { value } = await connection.getSignatureStatuses(sigs);
    if (s !== session) return;
    const updates = new Map(sigs.map((sig, i) => [sig, value[i]?.confirmationStatus]));
    let changed = false;
    state.history.items = state.history.items.map((it) => {
      const cs = updates.get(it.signature);
      if (!cs || cs === it.confirmationStatus) return it;
      changed = true;
      return { ...it, confirmationStatus: cs };
    });
    if (changed) renderHistory();
  } catch {
    /* 次回に再試行 */
  }
}

/** 保存済みのクエスト達成記録が、実際にオンチェーンで Finalized になっているかを確認 */
async function verifyRecords() {
  const s = session;
  const sigs = Object.values(state.progress)
    .map((r) => r.signature)
    .filter((sig) => !state.verification[sig]);
  if (sigs.length === 0) return;
  sigs.forEach((sig) => (state.verification[sig] = 'checking'));
  try {
    const { value } = await connection.getSignatureStatuses(sigs, { searchTransactionHistory: true });
    if (s !== session) return;
    sigs.forEach((sig, i) => {
      const st = value[i];
      state.verification[sig] = !st ? 'missing' : st.err ? 'failed' : 'verified';
    });
  } catch {
    sigs.forEach((sig) => delete state.verification[sig]);
  }
  render();
}

function onWalletChange() {
  session++;
  if (accountSubId !== null) {
    connection.removeAccountChangeListener(accountSubId).catch(() => {});
    accountSubId = null;
  }
  state.balance = null;
  state.airdrop = { state: 'idle', msg: '' };
  state.history = emptyHistory();
  state.verification = {};
  state.questError = null;
  state.transferError = null;
  if (!busy()) state.run = null;
  state.progress = owner() ? loadProgress(owner()) : {};
  if (state.modal?.type === 'wallet' && wallet.connected) closeModal();

  if (wallet.connected && state.network.status === 'ok') {
    refreshBalance();
    loadHistory();
    verifyRecords();
    // 送受信による残高変化を WebSocket で検知
    accountSubId = connection.onAccountChange(
      wallet.publicKey,
      (info) => {
        state.balance = info.lamports;
        render();
        scheduleHistoryRefresh();
      },
      'confirmed',
    );
  }
  render();
}

// ---------------------------------------------------------------- 送金・クエスト

async function runTransfer(to, lamports, context) {
  const run = { ...context, running: true, steps: initialSteps(), logs: [], signature: null, outcome: null };
  state.run = run;
  render();
  const tick = setInterval(tickElapsed, 100);
  try {
    const sig = await executeTransfer(
      {
        connection,
        from: wallet.publicKey,
        to,
        lamports,
        signTransaction: (tx) => wallet.signTransaction(tx),
      },
      {
        onStep: (key, patch) => {
          run.steps[key] = { ...run.steps[key], ...patch };
          render();
        },
        onLog: (message, level = 'info') => {
          run.logs.push({ at: Date.now(), message, level });
          renderFlows();
        },
        onSignature: (sig) => (run.signature = sig),
      },
    );
    run.outcome = 'success';
    return sig;
  } catch {
    run.outcome = 'error';
    return null;
  } finally {
    clearInterval(tick);
    run.running = false;
    render();
    refreshBalance();
    scheduleHistoryRefresh();
  }
}

async function challengeQuest(id) {
  if (busy() || !wallet.connected) return;
  const index = state.quests.findIndex((q) => q.id === id);
  const quest = state.quests[index];
  if (!quest || questStatus(quest, index) === 'locked' || state.progress[quest.id]) return;

  state.questError = null;
  let to, lamports;
  try {
    to = parsePublicKey(quest.recipient);
    lamports = parseSolToLamports(quest.amount);
    if (to.equals(wallet.publicKey)) throw new Error('クエストの送金先が接続中の自分のアドレスです。編集して変更してください。');
  } catch (e) {
    state.questError = errorMessage(e);
    render();
    return;
  }

  const s = session;
  const who = owner();
  const prevRank = rankFor(totalXp(state.quests, state.progress)).current.name;
  const sig = await runTransfer(to, lamports, { context: 'quest', questId: quest.id });
  if (!sig || s !== session) return;

  // 送金が Finalized になった時点でクエスト達成として記録
  state.progress = { ...state.progress, [quest.id]: { signature: sig, completedAt: Date.now() } };
  saveProgress(who, state.progress);
  state.verification[sig] = 'verified';
  const newRank = rankFor(totalXp(state.quests, state.progress)).current.name;
  render();
  openModal({
    type: 'clear',
    quest,
    signature: sig,
    rankUp: newRank !== prevRank ? newRank : null,
    allCleared: state.quests.every((q) => state.progress[q.id]),
  });
}

function saveEditor(form) {
  const m = state.modal;
  const data = new FormData(form);
  const quest = {
    ...m.quest,
    title: String(data.get('title')).trim(),
    description: String(data.get('description')).trim(),
    recipient: String(data.get('recipient')).trim(),
    amount: String(data.get('amount')).trim(),
    reward: Number(data.get('reward')),
  };
  const err =
    validateQuest(quest) ?? (quest.recipient === owner() ? '接続中の自分のアドレスは送金先にできません' : null);
  if (err) {
    $('#editor-error').innerHTML = `<div class="alert error">${escapeHtml(err)}</div>`;
    return;
  }
  state.quests = m.isNew ? [...state.quests, quest] : state.quests.map((q) => (q.id === quest.id ? quest : q));
  saveQuests(state.quests);
  closeModal();
  render();
}

function updateProgress(progress) {
  state.progress = progress;
  if (owner()) saveProgress(owner(), progress);
}

async function submitTransfer(form) {
  if (busy()) return;
  state.transferError = null;
  const data = new FormData(form);
  let to, lamports;
  try {
    to = parsePublicKey(data.get('recipient'));
    lamports = parseSolToLamports(data.get('amount'));
    if (to.equals(wallet.publicKey)) throw new Error('自分自身のアドレスには送金できません');
  } catch (e) {
    state.transferError = errorMessage(e);
    renderTransferForm();
    return;
  }
  const sig = await runTransfer(to, lamports, { context: 'transfer' });
  if (sig) form.elements.amount.value = '';
}

async function requestAirdrop() {
  const s = session;
  const pk = wallet.publicKey;
  const set = (airdrop) => {
    if (s !== session) return;
    state.airdrop = airdrop;
    render();
  };
  set({ state: 'running', msg: 'エアドロップを要求中…' });
  try {
    const sig = await connection.requestAirdrop(pk, web3.LAMPORTS_PER_SOL);
    set({ state: 'running', msg: '承認待ち…' });
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    set({ state: 'ok', msg: '1 SOL を受け取りました' });
    refreshBalance();
  } catch (e) {
    set({
      state: 'error',
      msg: `エアドロップに失敗しました（公開Faucetはレート制限が厳しいため「Faucet サイト」もご利用ください）: ${errorMessage(e)}`,
    });
  }
}

// ---------------------------------------------------------------- イベント

const actions = {
  'open-wallet-modal': () => openModal({ type: 'wallet' }),
  'connect-wallet': async (el) => {
    const entry = wallet.wallets[Number(el.dataset.index)];
    try {
      await wallet.connect(entry);
    } catch (e) {
      const box = $('#wallet-modal-error');
      if (box) box.innerHTML = `<div class="alert error">接続できませんでした: ${escapeHtml(errorMessage(e))}</div>`;
    }
  },
  disconnect: () => wallet.disconnect(),
  'close-modal': () => closeModal(),
  copy: async (el) => {
    await navigator.clipboard.writeText(el.dataset.value);
    el.textContent = '✔';
    setTimeout(() => (el.textContent = '⧉'), 1200);
  },
  'change-rpc': () => {
    const next = prompt('Devnet 用 RPC の URL を入力してください（空欄で既定値に戻します）', endpoint);
    if (next === null) return;
    setRpcEndpoint(next);
    location.reload();
  },
  mode: (el) => {
    state.mode = el.dataset.mode;
    localStorage.setItem(MODE_KEY, state.mode);
    render();
  },
  'refresh-balance': () => refreshBalance(),
  airdrop: () => requestAirdrop(),
  challenge: (el) => challengeQuest(el.dataset.id),
  'add-quest': () =>
    openModal({
      type: 'editor',
      isNew: true,
      quest: { id: newQuestId(), title: '', description: '', recipient: randomAddress(), amount: '0.001', reward: 100 },
    }),
  'edit-quest': (el) => {
    const quest = state.quests.find((q) => q.id === el.dataset.id);
    if (quest) openModal({ type: 'editor', isNew: false, quest });
  },
  'delete-quest': (el) => {
    const quest = state.quests.find((q) => q.id === el.dataset.id);
    if (!quest || !confirm(`クエスト「${quest.title}」を削除しますか？`)) return;
    state.quests = state.quests.filter((q) => q.id !== quest.id);
    saveQuests(state.quests);
    const { [quest.id]: _removed, ...rest } = state.progress;
    updateProgress(rest);
    if (state.run?.questId === quest.id) state.run = null;
    render();
  },
  'random-recipient': () => {
    const input = $('#quest-editor [name="recipient"]');
    if (input) input.value = randomAddress();
  },
  'reset-progress': () => {
    if (!confirm('このウォレットのクエスト進行状況をリセットしますか？（オンチェーンの取引は消えません）')) return;
    updateProgress({});
    state.run = null;
    state.questError = null;
    render();
  },
  'restore-quests': () => {
    if (!confirm('クエストを初期状態に戻しますか？（追加・編集したクエストと進行状況は消えます）')) return;
    state.quests = defaultQuests();
    saveQuests(state.quests);
    updateProgress({});
    state.run = null;
    render();
  },
  'history-tab': (el) => {
    state.history.tab = el.dataset.tab;
    renderHistory();
  },
  'refresh-history': () => loadHistory(),
  'load-more': () => loadHistory({ more: true }),
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  // モーダル内部のクリックで背景の「閉じる」が反応しないようにする
  if (el.classList.contains('modal-backdrop') && ev.target.closest('[data-stop]')) return;
  const action = actions[el.dataset.action];
  if (!action) return;
  ev.preventDefault();
  action(el);
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'transfer-form') submitTransfer(ev.target);
  if (ev.target.id === 'quest-editor') saveEditor(ev.target);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal) closeModal();
});

wallet.addEventListener('change', onWalletChange);
wallet.addEventListener('walletschange', () => {
  if (state.modal?.type === 'wallet') renderModal();
});

// ---------------------------------------------------------------- 起動

$('#transfer-view').innerHTML = views.transferFormHtml();
setInterval(pollPendingStatuses, STATUS_POLL_MS);
render();

assertDevnet(connection)
  .then(() => {
    state.network = { status: 'ok' };
    render();
    if (wallet.connected) onWalletChange();
    return wallet.autoConnect();
  })
  .catch((e) => {
    state.network = { status: 'error', message: errorMessage(e) };
    render();
  });
