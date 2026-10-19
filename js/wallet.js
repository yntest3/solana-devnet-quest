import { web3 } from './solana.js';

const DEVNET_CHAIN = 'solana:devnet';
const LAST_WALLET_KEY = 'sol-quest:last-wallet';

/**
 * ブラウザウォレットの検出・接続・署名を行う。
 * Wallet Standard（Phantom / Solflare / Backpack など）を優先し、
 * 未対応の環境では window.phantom.solana 等の従来の注入プロバイダにフォールバックする。
 *
 * イベント: 'walletschange'（検出ウォレット一覧の変化）, 'change'（接続状態・アカウントの変化）
 */
export class WalletManager extends EventTarget {
  constructor() {
    super();
    /** @type {{ name: string, icon: string, kind: 'standard' | 'legacy', raw: any }[]} */
    this.wallets = [];
    this.current = null;
    /** @type {import('@solana/web3.js').PublicKey | null} */
    this.publicKey = null;
    this._standardAccount = null;
    this._unsubscribe = null;
    this._discover();
  }

  get connected() {
    return !!this.publicKey;
  }

  _emit(type) {
    this.dispatchEvent(new Event(type));
  }

  _discover() {
    const api = Object.freeze({
      register: (...wallets) => {
        wallets.forEach((w) => this._addStandard(w));
        return () => {};
      },
    });
    window.addEventListener('wallet-standard:register-wallet', (e) => {
      try {
        e.detail(api);
      } catch (err) {
        console.error(err);
      }
    });
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

    const addLegacy = () => this._addLegacy();
    if (document.readyState === 'complete') setTimeout(addLegacy, 300);
    else window.addEventListener('load', () => setTimeout(addLegacy, 300));
  }

  _addStandard(w) {
    const isSolana = (w.chains ?? []).some((c) => c.startsWith('solana:'));
    const f = w.features ?? {};
    if (!isSolana || !f['standard:connect'] || !f['solana:signTransaction']) return;
    if (this.wallets.some((x) => x.name === w.name)) return;
    this.wallets.push({ name: w.name, icon: w.icon, kind: 'standard', raw: w });
    this._emit('walletschange');
  }

  _addLegacy() {
    const candidates = [
      { name: 'Phantom', provider: window.phantom?.solana },
      { name: 'Solflare', provider: window.solflare },
      { name: 'Backpack', provider: window.backpack },
    ];
    let added = false;
    for (const { name, provider } of candidates) {
      if (!provider?.signTransaction || this.wallets.some((x) => x.name === name)) continue;
      this.wallets.push({ name, icon: '', kind: 'legacy', raw: provider });
      added = true;
    }
    if (added) this._emit('walletschange');
  }

  _setAccount(publicKey, standardAccount = null) {
    this.publicKey = publicKey;
    this._standardAccount = standardAccount;
    this._emit('change');
  }

  async connect(entry, { silent = false } = {}) {
    if (this.current && this.current !== entry) await this.disconnect();

    if (entry.kind === 'standard') {
      const w = entry.raw;
      const { accounts } = await w.features['standard:connect'].connect(silent ? { silent: true } : undefined);
      const account = accounts[0];
      if (!account) throw new Error('ウォレットのアカウントを取得できませんでした');
      this.current = entry;
      this._unsubscribe = w.features['standard:events']?.on('change', ({ accounts: next }) => {
        if (!next) return;
        if (next.length === 0) this._clear();
        else this._setAccount(new web3.PublicKey(next[0].publicKey), next[0]);
      });
      this._setAccount(new web3.PublicKey(account.publicKey), account);
    } else {
      const p = entry.raw;
      const res = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
      const pk = res?.publicKey ?? p.publicKey;
      if (!pk) throw new Error('ウォレットのアカウントを取得できませんでした');
      this.current = entry;
      const onChange = (next) => (next ? this._setAccount(new web3.PublicKey(next.toString())) : this._clear());
      p.on?.('accountChanged', onChange);
      this._unsubscribe = () => p.off?.('accountChanged', onChange);
      this._setAccount(new web3.PublicKey(pk.toString()));
    }
    localStorage.setItem(LAST_WALLET_KEY, entry.name);
  }

  _clear() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.current = null;
    this._setAccount(null);
  }

  async disconnect() {
    const entry = this.current;
    localStorage.removeItem(LAST_WALLET_KEY);
    this._clear();
    try {
      if (entry?.kind === 'standard') await entry.raw.features['standard:disconnect']?.disconnect();
      else await entry?.raw.disconnect?.();
    } catch {
      /* 切断エラーは無視 */
    }
  }

  /** 前回接続したウォレットに、ユーザー操作なしで（承認済みの場合のみ）再接続を試みる */
  async autoConnect() {
    const name = localStorage.getItem(LAST_WALLET_KEY);
    if (!name) return;
    for (let i = 0; i < 15 && !this.wallets.some((w) => w.name === name); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const entry = this.wallets.find((w) => w.name === name);
    if (!entry) return;
    try {
      await this.connect(entry, { silent: true });
    } catch {
      /* 未承認なら何もしない */
    }
  }

  /**
   * トランザクションに署名させ、署名済みのシリアライズ済みバイト列を返す。
   * 送信はアプリ側で Devnet RPC に対して行う。
   * @param {import('@solana/web3.js').Transaction} tx
   * @returns {Promise<Uint8Array>}
   */
  async signTransaction(tx) {
    if (!this.current) throw new Error('ウォレットが接続されていません');
    if (this.current.kind === 'standard') {
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await this.current.raw.features['solana:signTransaction'].signTransaction({
        account: this._standardAccount,
        transaction: bytes,
        chain: DEVNET_CHAIN,
      });
      return out.signedTransaction;
    }
    const signed = await this.current.raw.signTransaction(tx);
    return signed.serialize();
  }
}
