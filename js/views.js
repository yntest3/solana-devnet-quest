// 画面各部の HTML を生成する関数群。ユーザー入力や外部データは必ず escapeHtml を通す。
import {
  escapeHtml as e,
  explorerAddressUrl,
  explorerTxUrl,
  formatSol,
  shortAddress,
} from './solana.js';
import { STEP_LABELS, STEP_ORDER } from './transfer.js';
import { rankFor, totalXp } from './quests.js';

export function addressHtml(address, { full = false, self = false } = {}) {
  return `<span class="address" title="${e(address)}">
    <a href="${explorerAddressUrl(e(address))}" target="_blank" rel="noreferrer">${e(full ? address : shortAddress(address))}</a>
    ${self ? '<span class="self-tag">自分</span>' : ''}
    <button type="button" class="icon-btn" data-action="copy" data-value="${e(address)}" aria-label="コピー">⧉</button>
  </span>`;
}

export function headerWalletHtml(wallet) {
  if (!wallet.connected) {
    return `<button type="button" class="btn primary" data-action="open-wallet-modal">ウォレット接続</button>`;
  }
  const icon = wallet.current?.icon ? `<img src="${e(wallet.current.icon)}" alt="" class="wallet-icon" />` : '';
  return `<div class="wallet-chip">${icon}<span class="mono">${e(shortAddress(wallet.publicKey.toBase58()))}</span>
    <button type="button" class="btn secondary small" data-action="disconnect">切断</button></div>`;
}

export function walletModalHtml(wallets) {
  const list = wallets.length
    ? wallets
        .map(
          (w, i) => `<button type="button" class="wallet-option" data-action="connect-wallet" data-index="${i}">
            ${w.icon ? `<img src="${e(w.icon)}" alt="" class="wallet-icon" />` : '<span class="wallet-icon placeholder">◎</span>'}
            <span>${e(w.name)}</span></button>`,
        )
        .join('')
    : `<p class="muted">対応ウォレットが見つかりません。以下のいずれかをブラウザにインストールしてください。</p>
       <ul class="install-list">
         <li><a href="https://phantom.com/" target="_blank" rel="noreferrer">Phantom</a></li>
         <li><a href="https://solflare.com/" target="_blank" rel="noreferrer">Solflare</a></li>
         <li><a href="https://backpack.app/" target="_blank" rel="noreferrer">Backpack</a></li>
       </ul>`;
  return `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal" role="dialog" aria-modal="true" data-stop>
      <h3>ウォレットを選択</h3>
      <div class="wallet-options">${list}</div>
      <div id="wallet-modal-error"></div>
      <div class="modal-actions"><button type="button" class="btn secondary" data-action="close-modal">閉じる</button></div>
    </div></div>`;
}

export function walletPanelHtml({ publicKey, walletName, balance, airdrop }) {
  return `<section class="card wallet-panel">
    <div class="wallet-info">
      <div>
        <div class="label">接続中のウォレット${walletName ? `（${e(walletName)}）` : ''}</div>
        ${addressHtml(publicKey.toBase58(), { full: true })}
      </div>
      <div class="balance">
        <div class="label">残高</div>
        <div class="balance-value">${balance === null ? '…' : formatSol(balance)} <span class="unit">SOL</span></div>
      </div>
    </div>
    <div class="wallet-actions">
      <button type="button" class="btn secondary" data-action="refresh-balance">残高更新</button>
      <button type="button" class="btn secondary" data-action="airdrop" ${airdrop.state === 'running' ? 'disabled' : ''}>
        Devnet SOL をエアドロップ (1 SOL)</button>
      <a class="btn secondary" href="https://faucet.solana.com" target="_blank" rel="noreferrer">Faucet サイト</a>
      ${airdrop.msg ? `<span class="inline-msg ${airdrop.state}">${e(airdrop.msg)}</span>` : ''}
    </div>
  </section>`;
}

export function flowHtml(run, { title = '送金処理の進捗', successMessage } = {}) {
  const now = Date.now();
  const steps = STEP_ORDER.map((key, i) => {
    const st = run.steps[key];
    const elapsed = st.startedAt !== undefined ? ((st.endedAt ?? now) - st.startedAt) / 1000 : null;
    const icon = st.status === 'done' ? '✔' : st.status === 'error' ? '✕' : i + 1;
    // 実行中のステップは data-elapsed-start を目印に経過時間だけを定期更新する
    const live = st.status === 'active' ? ` data-elapsed-start="${st.startedAt}"` : '';
    return `<li class="step ${st.status}">
      <div class="step-icon">${icon}</div>
      <div class="step-body">
        <div class="step-title">${STEP_LABELS[key].title}${elapsed !== null ? `<span class="elapsed"${live}>${elapsed.toFixed(1)}s</span>` : ''}</div>
        <div class="step-desc">${STEP_LABELS[key].desc}</div>
        ${st.detail ? `<div class="step-detail">${e(st.detail)}</div>` : ''}
      </div></li>`;
  }).join('');
  const logs = run.logs
    .map(
      (l) => `<div class="log-line ${l.level}"><span class="log-time">${new Date(l.at).toLocaleTimeString('ja-JP')}</span>${e(l.message)}</div>`,
    )
    .join('');
  return `<div class="flow">
    <h3>${e(title)}</h3>
    <ol class="stepper">${steps}</ol>
    ${run.signature ? `<div class="sig-line">シグネチャ: <a href="${explorerTxUrl(e(run.signature))}" target="_blank" rel="noreferrer">${e(run.signature)}</a></div>` : ''}
    ${run.outcome === 'success' && successMessage ? `<div class="alert success">${e(successMessage)}</div>` : ''}
    ${run.outcome === 'error' ? '<div class="alert error">送金に失敗しました。ログを確認してください。</div>' : ''}
    <div class="log" data-log>${logs}</div>
  </div>`;
}

export function transferFormHtml() {
  return `<section class="card">
    <h2>SOL を送金（自由送金）</h2>
    <form class="transfer-form" id="transfer-form">
      <label><span class="label">送金先アドレス</span>
        <input type="text" name="recipient" placeholder="例: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" spellcheck="false" autocomplete="off" /></label>
      <label><span class="label">数量 (SOL)<span class="muted" id="form-balance"></span></span>
        <input type="text" name="amount" inputmode="decimal" placeholder="0.1" autocomplete="off" /></label>
      <button type="submit" class="btn primary" id="transfer-submit">送金する</button>
    </form>
    <div id="transfer-error"></div>
    <div data-flow-slot="transfer"></div>
  </section>`;
}

export function questProgressHtml(quests, progress, activeQuestId) {
  const achieved = quests.filter((q) => progress[q.id]).length;
  const total = quests.length;
  const percent = total === 0 ? 0 : Math.round((achieved / total) * 100);
  const xp = totalXp(quests, progress);
  const maxXp = quests.reduce((sum, q) => sum + q.reward, 0);
  const { current, next } = rankFor(xp);
  const currentIndex = quests.findIndex((q) => !progress[q.id]);
  const nextQuest = currentIndex >= 0 ? quests[currentIndex] : null;

  const stages = quests
    .map((q, i) => {
      const state = progress[q.id] ? 'done' : q.id === activeQuestId ? 'active' : i === currentIndex ? 'current' : 'locked';
      const node = state === 'done' ? '★' : state === 'locked' ? '🔒' : i + 1;
      const line = i > 0 ? `<div class="stage-line ${progress[quests[i - 1].id] ? 'done' : ''}"></div>` : '';
      return `<div class="stage-wrap">${line}<div class="stage-node ${state}" title="${e(q.title)}">${node}</div>
        <div class="stage-label">${e(q.title)}</div></div>`;
    })
    .join('');

  const nextHtml =
    total === 0
      ? '<span class="muted">クエストがありません。「クエストを追加」から作成してください。</span>'
      : nextQuest
        ? `次のクエスト: <strong>${e(nextQuest.title)}</strong>（${e(nextQuest.amount)} SOL を送金）`
        : '<strong class="ok">🏆 全クエスト制覇！おめでとうございます！</strong>';

  return `<section class="card quest-progress">
    <div class="qp-top">
      <div><div class="label">クエスト進行状況</div>
        <div class="qp-count">${achieved} <span class="muted">/ ${total} 達成</span></div></div>
      <div class="qp-stat"><div class="label">経験値</div>
        <div class="qp-xp">${xp} <span class="muted">/ ${maxXp} XP</span></div></div>
      <div class="qp-stat"><div class="label">ランク</div>
        <div class="qp-rank">${e(current.name)}</div>
        ${next ? `<div class="muted small">次のランクまで ${next.xp - xp} XP</div>` : ''}</div>
    </div>
    <div class="progress-bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-fill" style="width:${percent}%"></div><span class="progress-text">${percent}%</span>
    </div>
    <div class="stage-map">${stages}</div>
    <div class="qp-next">${nextHtml}</div>
  </section>`;
}

const STATUS_LABEL = {
  locked: '🔒 ロック中',
  available: '挑戦可能',
  running: '挑戦中',
  failed: '失敗',
  achieved: '★ クエスト達成',
};

const VERIFY_LABEL = {
  verified: '✔ オンチェーンで Finalized を確認',
  missing: '⚠ オンチェーンで見つかりません（Devnet リセットの可能性）',
  failed: '✕ オンチェーンでは失敗した取引です',
  checking: 'オンチェーン確認中…',
};

export function questCardHtml({ quest, index, status, record, verification, currentStep, busy }) {
  const challengeLabel = status === 'running' ? '挑戦中…' : status === 'failed' ? '再挑戦する' : '挑戦する';
  const v = verification ?? 'checking';
  return `<article class="quest-card ${status}" data-quest-id="${e(quest.id)}">
    <div class="quest-head">
      <div class="quest-no">QUEST ${index + 1}</div>
      <span class="quest-status ${status}">${STATUS_LABEL[status]}${status === 'running' && currentStep ? `: ${e(currentStep)}` : ''}</span>
    </div>
    <h3 class="quest-title">${e(quest.title)}</h3>
    ${quest.description ? `<p class="quest-desc">${e(quest.description)}</p>` : ''}
    <dl class="quest-spec">
      <div><dt>送金先</dt><dd>${addressHtml(quest.recipient)}</dd></div>
      <div><dt>数量</dt><dd class="mono strong">${e(quest.amount)} SOL</dd></div>
      <div><dt>報酬</dt><dd class="mono strong reward">+${quest.reward} XP</dd></div>
    </dl>
    ${
      record
        ? `<div class="quest-record">
            <span>達成日時: ${new Date(record.completedAt).toLocaleString('ja-JP')}</span>
            <a href="${explorerTxUrl(e(record.signature))}" target="_blank" rel="noreferrer">Tx ${e(shortAddress(record.signature, 5))}</a>
            <span class="verify ${v}">${VERIFY_LABEL[v]}</span>
          </div>`
        : ''
    }
    <div class="quest-actions">
      ${
        status !== 'achieved'
          ? `<button type="button" class="btn primary" data-action="challenge" data-id="${e(quest.id)}" ${busy || status === 'locked' ? 'disabled' : ''}>${challengeLabel}</button>`
          : ''
      }
      <button type="button" class="btn secondary" data-action="edit-quest" data-id="${e(quest.id)}" ${busy || status === 'achieved' ? 'disabled' : ''}
        ${status === 'achieved' ? 'title="達成済みのクエストは編集できません"' : ''}>編集</button>
      <button type="button" class="btn secondary danger" data-action="delete-quest" data-id="${e(quest.id)}" ${busy ? 'disabled' : ''}>削除</button>
    </div>
    <div data-flow-slot="quest:${e(quest.id)}"></div>
  </article>`;
}

export function questEditorModalHtml(quest, isNew) {
  return `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal editor-modal" role="dialog" aria-modal="true" data-stop>
      <form class="quest-editor" id="quest-editor">
        <h3>${isNew ? '新しいクエスト' : 'クエストを編集'}</h3>
        <label><span class="label">クエスト名</span>
          <input name="title" maxlength="40" value="${e(quest.title)}" /></label>
        <label><span class="label">説明</span>
          <input name="description" maxlength="120" value="${e(quest.description)}" /></label>
        <label><span class="label">送金先アドレス</span>
          <div class="input-row">
            <input name="recipient" class="mono" spellcheck="false" autocomplete="off" value="${e(quest.recipient)}" />
            <button type="button" class="btn secondary" data-action="random-recipient">ランダム生成</button>
          </div>
          <span class="hint">ウォレットで作った別アカウントのアドレスを入れると、受信側でも確認できます。
            ランダム生成したアドレスは鍵を持たない使い捨てアドレスです。</span></label>
        <div class="editor-grid">
          <label><span class="label">送金数量 (SOL)</span>
            <input name="amount" class="mono" inputmode="decimal" value="${e(quest.amount)}" />
            <span class="hint">未使用アドレス宛は約 0.00089 SOL 以上が必要です</span></label>
          <label><span class="label">報酬 (XP)</span>
            <input name="reward" class="mono" inputmode="numeric" value="${e(quest.reward)}" /></label>
        </div>
        <div id="editor-error"></div>
        <div class="modal-actions">
          <button type="button" class="btn secondary" data-action="close-modal">キャンセル</button>
          <button type="submit" class="btn primary">保存</button>
        </div>
      </form>
    </div></div>`;
}

export function clearModalHtml({ quest, signature, rankUp, allCleared }) {
  const sparkles = Array.from({ length: 12 }, (_, i) => `<span style="--i:${i}">✦</span>`).join('');
  return `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal clear-modal" role="dialog" aria-modal="true" data-stop>
      <div class="sparkles" aria-hidden="true">${sparkles}</div>
      <div class="clear-title">QUEST CLEAR!</div>
      <div class="clear-sub">クエスト達成</div>
      <h3 class="clear-quest">${e(quest.title)}</h3>
      <div class="clear-detail">
        <div><strong class="mono">${e(quest.amount)} SOL</strong> → ${addressHtml(quest.recipient)}</div>
        <div class="clear-xp">+${quest.reward} XP</div>
        ${rankUp ? `<div class="rank-up">ランクアップ！「${e(rankUp)}」になりました</div>` : ''}
        ${allCleared ? '<div class="rank-up">🏆 全クエスト制覇！</div>' : ''}
        <div class="muted small">送金はオンチェーンで Finalized（確定）になりました ・
          <a href="${explorerTxUrl(e(signature))}" target="_blank" rel="noreferrer">Explorer で確認</a></div>
      </div>
      <button type="button" class="btn primary" data-action="close-modal" autofocus>閉じる</button>
    </div></div>`;
}

const HISTORY_TABS = [
  { key: 'sent', label: '送信履歴' },
  { key: 'received', label: '受信履歴' },
  { key: 'all', label: 'すべて' },
];

function statusBadge(i) {
  if (!i.success) return `<span class="status failed" title="${e(i.error)}">失敗</span>`;
  if (i.confirmationStatus === 'finalized') return '<span class="status finalized">確定 (Finalized)</span>';
  if (i.confirmationStatus === 'confirmed') return '<span class="status confirmed">承認済 (Confirmed)</span>';
  return '<span class="status processed">処理中 (Processed)</span>';
}

export function historyHtml(history, owner) {
  const { items, tab, loading, error, failed, cursor } = history;
  const isSent = (i) => i.direction !== 'received';
  const isReceived = (i) => i.direction !== 'sent';
  const counts = { sent: items.filter(isSent).length, received: items.filter(isReceived).length, all: items.length };
  const visible = items.filter((i) => (tab === 'all' ? true : tab === 'sent' ? isSent(i) : isReceived(i)));

  const tabs = HISTORY_TABS.map(
    (t) => `<button type="button" class="tab ${tab === t.key ? 'active' : ''}" data-action="history-tab" data-tab="${t.key}">
      ${t.label} <span class="count">${counts[t.key]}</span></button>`,
  ).join('');

  const rows = visible.length
    ? visible
        .map((i) => {
          const sign = i.direction === 'sent' ? '−' : i.direction === 'received' ? '+' : '';
          const dirLabel = i.direction === 'sent' ? '送信' : i.direction === 'received' ? '受信' : '自己';
          return `<tr>
            <td class="nowrap">${i.blockTime ? new Date(i.blockTime * 1000).toLocaleString('ja-JP') : '—'}</td>
            <td><span class="dir ${i.direction}">${dirLabel}</span></td>
            <td>${addressHtml(i.from, { self: i.from === owner })}</td>
            <td>${addressHtml(i.to, { self: i.to === owner })}</td>
            <td class="num amount ${i.direction}">${sign}${formatSol(i.lamports)}</td>
            <td>${statusBadge(i)}</td>
            <td><a href="${explorerTxUrl(e(i.signature))}" target="_blank" rel="noreferrer" title="${e(i.signature)}">${e(shortAddress(i.signature, 5))}</a></td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="empty">${loading ? '読み込み中…' : '該当する取引はありません'}</td></tr>`;

  return `<section class="card">
    <div class="history-header">
      <h2>送受信履歴</h2>
      <div class="history-actions">
        ${loading ? '<span class="muted">読み込み中…</span>' : ''}
        <button type="button" class="btn secondary" data-action="refresh-history" ${loading ? 'disabled' : ''}>更新</button>
      </div>
    </div>
    <div class="tabs">${tabs}</div>
    ${error ? `<div class="alert error">履歴の取得に失敗しました: ${e(error)}</div>` : ''}
    ${
      failed.size
        ? `<div class="alert warn">RPC のレート制限により ${failed.size} 件のトランザクションを取得できませんでした。
            しばらく待ってから「更新」を押してください（README の「RPC エンドポイントの変更」も参照）。</div>`
        : ''
    }
    <div class="table-wrap"><table class="history">
      <thead><tr><th>日時</th><th>種別</th><th>送信元</th><th>送信先</th><th class="num">数量 (SOL)</th><th>状態</th><th>Tx</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${cursor ? `<div class="center"><button type="button" class="btn secondary" data-action="load-more" ${loading ? 'disabled' : ''}>さらに読み込む</button></div>` : ''}
  </section>`;
}
