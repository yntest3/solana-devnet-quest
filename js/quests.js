import { web3, parsePublicKey, parseSolToLamports } from './solana.js';

/**
 * @typedef {{ id: string, title: string, description: string, recipient: string, amount: string, reward: number }} Quest
 * @typedef {{ signature: string, completedAt: number }} QuestRecord
 */

const QUESTS_KEY = 'sol-quest:quests:v1';
const progressKey = (owner) => `sol-quest:progress:v1:${owner}`;

export const newQuestId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 鍵を保持しない使い捨てアドレス（Devnet のテスト送金先として使用） */
export const randomAddress = () => web3.Keypair.generate().publicKey.toBase58();

/** @returns {Quest[]} */
export function defaultQuests() {
  const presets = [
    {
      title: 'はじめての送金',
      description: 'まずは少額の SOL を送って、署名から確定までの流れを体験しよう。',
      amount: '0.001',
      reward: 100,
    },
    { title: '仲間に軍資金を', description: '旅の仲間に 0.005 SOL を届けよう。', amount: '0.005', reward: 150 },
    { title: '商人との取引', description: '商人に 0.01 SOL を支払ってアイテムを手に入れよう。', amount: '0.01', reward: 200 },
    { title: 'ギルドへの寄付', description: 'ギルドの運営資金として 0.02 SOL を寄付しよう。', amount: '0.02', reward: 300 },
    {
      title: '竜の宝物庫',
      description: '最後の試練。宝物庫に 0.05 SOL を納めて伝説を残そう。',
      amount: '0.05',
      reward: 500,
    },
  ];
  return presets.map((p) => ({ ...p, id: newQuestId(), recipient: randomAddress() }));
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @returns {Quest[]} */
export function loadQuests() {
  const stored = readJson(QUESTS_KEY);
  if (Array.isArray(stored)) return stored;
  const quests = defaultQuests();
  saveQuests(quests);
  return quests;
}

export const saveQuests = (quests) => localStorage.setItem(QUESTS_KEY, JSON.stringify(quests));

/** @returns {Record<string, QuestRecord>} */
export const loadProgress = (owner) => readJson(progressKey(owner)) ?? {};

export const saveProgress = (owner, progress) => localStorage.setItem(progressKey(owner), JSON.stringify(progress));

/** 入力内容を検証し、問題があればエラーメッセージを返す */
export function validateQuest(q) {
  if (!q.title.trim()) return 'クエスト名を入力してください';
  if (q.title.length > 40) return 'クエスト名は40文字以内にしてください';
  try {
    parsePublicKey(q.recipient);
    parseSolToLamports(q.amount);
  } catch (e) {
    return e.message;
  }
  if (!Number.isInteger(q.reward) || q.reward < 1 || q.reward > 10000) {
    return '報酬XPは 1〜10000 の整数で入力してください';
  }
  return null;
}

export const RANKS = [
  { xp: 0, name: '見習い送金士' },
  { xp: 300, name: 'ブロックの旅人' },
  { xp: 700, name: 'バリデータの友' },
  { xp: 1250, name: 'Devnet マスター' },
];

export function rankFor(xp) {
  let index = 0;
  RANKS.forEach((r, i) => {
    if (xp >= r.xp) index = i;
  });
  return { current: RANKS[index], next: RANKS[index + 1] };
}

export const totalXp = (quests, progress) => quests.reduce((sum, q) => sum + (progress[q.id] ? q.reward : 0), 0);
