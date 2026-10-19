const CONCURRENCY = 2;
const MAX_ATTEMPTS = 4;
// Devnet には v0 に加えて v1 トランザクションも存在する
const MAX_TX_VERSION = 1;
const FAILED = Symbol('failed');

/** 公開RPCのレート制限(429)を避けるため、並列数を絞って1件ずつ取得する */
async function fetchParsed(connection, signatures) {
  const results = new Array(signatures.length).fill(FAILED);
  let next = 0;
  const worker = async () => {
    while (next < signatures.length) {
      const i = next++;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          results[i] = await connection.getParsedTransaction(signatures[i], {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: MAX_TX_VERSION,
          });
          break;
        } catch (e) {
          if (attempt === MAX_ATTEMPTS) console.warn(`トランザクション取得失敗 ${signatures[i]}`, e);
          else await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

const isSystemTransfer = (ix) =>
  'parsed' in ix &&
  ix.program === 'system' &&
  (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferWithSeed');

/** トランザクション内（CPI含む）の System Program 送金のうち、owner が関わるものを抽出 */
function extractTransfers(owner, sigInfo, tx) {
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
  ];
  const items = [];
  instructions.forEach((ix, idx) => {
    if (!isSystemTransfer(ix)) return;
    const { source, destination, lamports } = ix.parsed.info;
    if (source !== owner && destination !== owner) return;
    items.push({
      id: `${sigInfo.signature}:${idx}`,
      signature: sigInfo.signature,
      slot: sigInfo.slot,
      blockTime: tx.blockTime ?? sigInfo.blockTime ?? null,
      from: source,
      to: destination,
      lamports,
      direction: source === destination ? 'self' : source === owner ? 'sent' : 'received',
      success: !tx.meta?.err,
      error: tx.meta?.err ? JSON.stringify(tx.meta.err) : undefined,
      confirmationStatus: sigInfo.confirmationStatus,
    });
  });
  return items;
}

/**
 * オンチェーンの署名履歴を取得し、SOL 送受信のみに絞り込んで返す
 * @returns {Promise<{ items, before?: string, fetched: string[], failed: string[] }>}
 */
export async function fetchTransferHistory(connection, owner, { limit = 20, before } = {}) {
  const sigs = await connection.getSignaturesForAddress(owner, { limit, before }, 'confirmed');
  const txs = await fetchParsed(
    connection,
    sigs.map((s) => s.signature),
  );
  const ownerStr = owner.toBase58();
  const items = sigs.flatMap((s, i) => (txs[i] && txs[i] !== FAILED ? extractTransfers(ownerStr, s, txs[i]) : []));
  return {
    items,
    before: sigs.length === limit ? sigs[sigs.length - 1].signature : undefined,
    fetched: sigs.filter((_, i) => txs[i] !== FAILED).map((s) => s.signature),
    failed: sigs.filter((_, i) => txs[i] === FAILED).map((s) => s.signature),
  };
}

export const mergeHistoryItems = (a, b) => {
  const map = new Map(a.map((i) => [i.id, i]));
  b.forEach((i) => map.set(i.id, i));
  return [...map.values()].sort((x, y) => y.slot - x.slot || x.id.localeCompare(y.id));
};
