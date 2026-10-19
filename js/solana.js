// vendor/solana-web3.min.js（@solana/web3.js の IIFE ビルド）が公開するグローバルを利用する
export const web3 = window.solanaWeb3;
const { Connection, PublicKey, LAMPORTS_PER_SOL } = web3;

/** Devnet のジェネシスハッシュ。接続先RPCが本当に Devnet かを検証するために使う。 */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEFAULT_RPC = 'https://api.devnet.solana.com';
const RPC_KEY = 'sol-quest:rpc';

/** RPC エンドポイント: URL の ?rpc= → 画面で保存した値 → 既定の公開 Devnet RPC の順に採用 */
export function getRpcEndpoint() {
  const fromQuery = new URLSearchParams(location.search).get('rpc');
  return (fromQuery || localStorage.getItem(RPC_KEY) || DEFAULT_RPC).trim();
}

export function setRpcEndpoint(url) {
  if (url && url.trim()) localStorage.setItem(RPC_KEY, url.trim());
  else localStorage.removeItem(RPC_KEY);
}

export const createConnection = (endpoint) => new Connection(endpoint, 'confirmed');

export async function assertDevnet(connection) {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `接続先RPC (${connection.rpcEndpoint}) は Devnet ではありません (genesis: ${genesis})。` +
        'このアプリは Devnet 専用です。',
    );
  }
}

export const explorerTxUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddressUrl = (addr) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;

export const shortAddress = (addr, chars = 4) =>
  addr.length <= chars * 2 + 3 ? addr : `${addr.slice(0, chars)}…${addr.slice(-chars)}`;

const LAMPORTS = BigInt(LAMPORTS_PER_SOL);

/** lamports → SOL 表示（末尾の0は除去） */
export function formatSol(lamports) {
  const v = BigInt(lamports);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / LAMPORTS;
  const frac = (abs % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** "1.5" などの SOL 文字列を浮動小数点誤差なしに lamports(bigint) へ変換 */
export function parseSolToLamports(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('数量は正の数値で入力してください');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 9) throw new Error('小数点以下は9桁（1 lamport）までです');
  const lamports = BigInt(whole) * LAMPORTS + BigInt(frac.padEnd(9, '0'));
  if (lamports <= 0n) throw new Error('0より大きい数量を入力してください');
  return lamports;
}

export function parsePublicKey(input) {
  try {
    return new PublicKey(String(input).trim());
  } catch {
    throw new Error('送金先アドレスが不正です（Base58形式の公開鍵を入力してください）');
  }
}

export function errorMessage(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
