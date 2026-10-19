import { web3, errorMessage, formatSol, shortAddress } from './solana.js';

const { SystemProgram, Transaction } = web3;

export const STEP_ORDER = ['build', 'sign', 'send', 'processed', 'confirmed', 'finalized'];

export const STEP_LABELS = {
  build: { title: 'トランザクション作成', desc: '最新ブロックハッシュ取得・手数料見積り・残高検証' },
  sign: { title: 'ウォレット署名', desc: 'ウォレットで内容を確認して署名' },
  send: { title: 'ネットワーク送信', desc: '署名済みトランザクションを Devnet RPC へ送信' },
  processed: { title: 'Processed', desc: 'リーダーのブロックに取り込まれた' },
  confirmed: { title: 'Confirmed', desc: 'クラスタのステークの2/3以上が投票' },
  finalized: { title: 'Finalized', desc: '後続ブロックが積み上がり確定（巻き戻り不可）' },
};

export const initialSteps = () => Object.fromEntries(STEP_ORDER.map((k) => [k, { status: 'pending' }]));

const POLL_INTERVAL_MS = 500;
const REBROADCAST_INTERVAL_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * SOL 送金を実行し、各段階（作成→署名→送信→processed→confirmed→finalized）の進捗をコールバックで通知する。
 * 署名と送信を分離することで、ウォレット側のネットワーク設定に関係なく必ず Devnet RPC に送信する。
 *
 * @param {{ connection, from, to, lamports: bigint, signTransaction: (tx) => Promise<Uint8Array> }} params
 * @param {{ onStep: (key, patch) => void, onLog: (message, level?) => void, onSignature: (sig) => void }} cb
 * @returns {Promise<string>} Finalized になったトランザクションのシグネチャ
 */
export async function executeTransfer({ connection, from, to, lamports, signTransaction }, cb) {
  let current = 'build';
  const start = (key, detail) => {
    current = key;
    cb.onStep(key, { status: 'active', startedAt: Date.now(), detail });
  };
  const done = (key, detail) => cb.onStep(key, { status: 'done', endedAt: Date.now(), detail });

  try {
    // 1. トランザクション作成
    start('build');
    cb.onLog(`送金準備: ${formatSol(lamports)} SOL → ${to.toBase58()}`);
    const [{ blockhash, lastValidBlockHeight }, senderBalance, recipientBalance, rentMin] = await Promise.all([
      connection.getLatestBlockhash('confirmed'),
      connection.getBalance(from, 'confirmed'),
      connection.getBalance(to, 'confirmed'),
      connection.getMinimumBalanceForRentExemption(0),
    ]);
    cb.onLog(`最新ブロックハッシュ取得: ${blockhash}（有効期限ブロック高: ${lastValidBlockHeight}）`);

    const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
    );
    const feeRes = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
    const fee = BigInt(feeRes.value ?? 5000);
    cb.onLog(`手数料見積り: ${formatSol(fee)} SOL`);

    const remaining = BigInt(senderBalance) - lamports - fee;
    if (remaining < 0n) {
      throw new Error(
        `残高不足です（残高 ${formatSol(senderBalance)} SOL / 必要 ${formatSol(lamports + fee)} SOL）`,
      );
    }
    if (remaining > 0n && remaining < BigInt(rentMin)) {
      throw new Error(
        `送金後の残高 ${formatSol(remaining)} SOL がレント免除最低額 ${formatSol(rentMin)} SOL を下回ります。` +
          '数量を減らすか、手数料を除いた全額を送金してください。',
      );
    }
    if (recipientBalance === 0 && lamports < BigInt(rentMin)) {
      throw new Error(
        `送金先は未使用アカウントのため、最低 ${formatSol(rentMin)} SOL（レント免除額）以上を送金する必要があります。`,
      );
    }
    done('build', `手数料 ${formatSol(fee)} SOL`);

    // 2. 署名
    start('sign', 'ウォレットの承認待ち…');
    cb.onLog('ウォレットに署名を要求しました');
    let raw;
    try {
      raw = await signTransaction(tx);
    } catch (e) {
      throw new Error(`署名が拒否またはキャンセルされました: ${errorMessage(e)}`);
    }
    done('sign', '署名完了');
    cb.onLog('ウォレットで署名されました', 'success');

    // 3. 送信（preflight シミュレーション込み）
    start('send', 'RPC へ送信中…');
    const signature = await connection.sendRawTransaction(raw, {
      preflightCommitment: 'confirmed',
      maxRetries: 0, // 再送は下のループで自前で行う
    });
    cb.onSignature(signature);
    done('send', `sig ${shortAddress(signature, 8)}`);
    cb.onLog(`送信完了 シグネチャ: ${signature}`, 'success');

    // 4〜6. コミットメントの進行を監視
    start('processed', 'ブロックへの取り込み待ち…');
    let lastBroadcast = Date.now();
    let reached = 'none';

    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const status = (await connection.getSignatureStatuses([signature])).value[0];

      if (status?.err) {
        throw new Error(`トランザクションが失敗しました: ${JSON.stringify(status.err)}`);
      }

      const level = status?.confirmationStatus;
      if (status && level && reached === 'none') {
        done('processed', `slot ${status.slot}`);
        cb.onLog(`Processed: slot ${status.slot} に取り込まれました`);
        start('confirmed', '投票待ち…');
        reached = 'processed';
      }
      if (status && (level === 'confirmed' || level === 'finalized') && reached === 'processed') {
        done('confirmed', `slot ${status.slot}`);
        cb.onLog('Confirmed: クラスタの超過半数が承認しました', 'success');
        start('finalized', 'ファイナリティ待ち…（通常十数秒）');
        reached = 'confirmed';
      }
      if (status && level === 'finalized') {
        done('finalized', `slot ${status.slot}`);
        cb.onLog('Finalized: トランザクションが確定しました', 'success');
        return signature;
      }

      if (reached === 'none') {
        // 未取り込みのうちは期限切れチェックと再送を行う
        const blockHeight = await connection.getBlockHeight('confirmed');
        if (blockHeight > lastValidBlockHeight) {
          throw new Error('ブロックハッシュの有効期限が切れました。もう一度送金してください。');
        }
        if (Date.now() - lastBroadcast > REBROADCAST_INTERVAL_MS) {
          await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
          lastBroadcast = Date.now();
          cb.onLog(`未取り込みのため再送信しました（現在ブロック高 ${blockHeight}）`);
        }
      }
    }
  } catch (e) {
    const msg = errorMessage(e);
    cb.onStep(current, { status: 'error', endedAt: Date.now(), detail: msg });
    cb.onLog(msg, 'error');
    throw e;
  }
}
