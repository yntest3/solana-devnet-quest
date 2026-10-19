# Solana Devnet SOL Quest

Solana **Devnet** 上で実際に SOL を送金してクエストを攻略するブラウザゲームです。
クエストごとに送金先と SOL 数量が決まっており、送金がオンチェーンで **Finalized（確定）** になると「クエスト達成」になります。

ビルド不要の静的サイト（HTML / CSS / JavaScript）なので、リポジトリに push して GitHub Pages などで公開するだけで動きます。

## 主な機能

| 機能 | 内容 |
| --- | --- |
| クエスト | クエストごとに「送金先アドレス」「SOL 数量」「報酬 XP」を設定。前のクエストを達成すると次が解放されます |
| クエスト編集 | クエストの追加・編集・削除、送金先のランダム生成、進行状況リセット、初期クエストへの復元 |
| 進行状況の表示 | 達成数 / 達成率バー / 経験値 / ランク / ステージマップ / 次のクエスト |
| 達成判定 | 送金が Finalized になった時点で達成とし、「QUEST CLEAR!」演出を表示。保存済みの達成記録は起動時にオンチェーンで再検証します |
| 送金フロー可視化 | 作成 → 署名 → 送信 → Processed → Confirmed → Finalized の6段階と経過時間・ログをリアルタイム表示 |
| 自由送金 | クエストとは別に、任意のアドレス・数量で送金 |
| 送受信履歴 | 送信履歴 / 受信履歴 / すべて。日時・送信元・送信先・数量・取引状態をオンチェーンデータから表示 |
| Devnet 限定 | RPC のジェネシスハッシュを検証し、Devnet 以外では動作しません |

## 公開方法（GitHub Pages）

```bash
cd solana-devnet-quest
git init
git add .
git commit -m "Solana Devnet SOL Quest"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

1. GitHub のリポジトリで **Settings → Pages** を開きます。
2. **Build and deployment** の Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして保存します。
3. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

`.nojekyll` を同梱しているので、ファイルはそのまま配信されます。Netlify / Vercel / Cloudflare Pages など、他の静的ホスティングでも同様に公開できます。

## ローカルでの起動方法

ブラウザウォレットは `file://` で開いたページには接続できません。また ES Modules を使っているため、ローカル HTTP サーバー経由で開いてください。

```bash
cd solana-devnet-quest

# Node.js がある場合
npx serve .            # → http://localhost:3000

# Python がある場合
python -m http.server 8000   # → http://localhost:8000
```

## 遊び方

1. ブラウザに [Phantom](https://phantom.com/) や [Solflare](https://solflare.com/) などのウォレットを入れ、ネットワークを Devnet に切り替えます（推奨）。
   - Phantom: 設定 → 開発者設定 → テストネットモード ON → Solana Devnet
   - 送金はアプリが Devnet RPC に対して行うため、ウォレットが Mainnet 設定のままでも Mainnet に送金されることはありません。
2. 「ウォレット接続」からウォレットを接続します。
3. 残高が無い場合は「Devnet SOL をエアドロップ」を押します。上限に達している場合は「Faucet サイト」(<https://faucet.solana.com>) で入手してください。
   初期クエストを全部クリアするには、手数料込みで約 0.09 SOL が必要です。
4. 「🎮 クエスト」タブで QUEST 1 の「挑戦する」を押し、ウォレットで署名します。
5. 進捗表示で Finalized まで進むと「QUEST CLEAR!」が表示され、XP が加算されて次のクエストが解放されます。

### クエストの設定

- 「＋ クエストを追加」または各クエストの「編集」で、クエスト名・説明・**送金先アドレス**・**送金数量**・報酬 XP を設定できます。
- 初期クエストの送金先は、鍵を持たないランダムなアドレスです。ウォレットで2つ目のアカウントを作り、そのアドレスを送金先にすると受信履歴も確認できます。
- 未使用のアドレスに送る場合は、レント免除額（約 0.00089 SOL）以上を送る必要があります。
- 達成済みのクエストは編集できません（削除、または「進行状況をリセット」は可能です）。

### データの保存場所

| データ | 保存先 |
| --- | --- |
| クエスト定義 | ブラウザの localStorage（全ウォレット共通） |
| 進行状況（達成したクエストとシグネチャ） | ブラウザの localStorage（ウォレットアドレスごと） |
| 送金・履歴 | Solana Devnet（オンチェーン） |

達成記録には送金のシグネチャを保存し、起動時に `getSignatureStatuses` で実在と成功を確認します。Devnet がリセットされてトランザクションが見つからない場合は、警告を表示します。

## RPC エンドポイントの変更（任意）

公開 RPC（`https://api.devnet.solana.com`）はレート制限が厳しく、履歴の読み込みやエアドロップで `429 Too Many Requests` が出ることがあります。
Helius / QuickNode などの **Devnet 用** RPC を使う場合は、次のどちらかで指定します。

- 画面上部の RPC 表示の横にある「変更」から入力（ブラウザに保存されます）
- URL に `?rpc=` を付ける: `https://<公開URL>/?rpc=https://devnet.helius-rpc.com/?api-key=xxxx`

API キー付きの URL をソースコードに書いて公開しないよう注意してください。Mainnet / Testnet の URL を指定した場合は、ジェネシスハッシュ検証でエラーになります。

## 送金フローの各段階

| 段階 | 処理内容 |
| --- | --- |
| 1. トランザクション作成 | 最新ブロックハッシュ取得、`SystemProgram.transfer` 命令の作成、手数料見積り、残高不足・レント免除額の事前検証 |
| 2. ウォレット署名 | Wallet Standard の `solana:signTransaction` で署名（拒否すると失敗表示） |
| 3. ネットワーク送信 | `sendRawTransaction` で Devnet RPC に送信（preflight シミュレーションあり） |
| 4. Processed | `getSignatureStatuses` を 500ms ごとに確認。未取り込みの間は2秒ごとに再送し、ブロックハッシュの期限切れも検知 |
| 5. Confirmed | クラスタのステークの 2/3 以上が投票 |
| 6. Finalized | 確定（巻き戻り不可）。クエストモードではここで達成 |

## ディレクトリ構成

```
.
├── index.html               画面の骨組み
├── .nojekyll                GitHub Pages でそのまま配信するための空ファイル
├── css/
│   ├── style.css            基本スタイル（カード・送金フロー・履歴）
│   └── quest.css            クエスト・モーダル・ウォレット選択のスタイル
├── js/
│   ├── app.js               状態管理・イベント処理・描画の制御
│   ├── views.js             各画面部品の HTML 生成
│   ├── wallet.js            ウォレット検出・接続・署名（Wallet Standard + 従来プロバイダ）
│   ├── transfer.js          送金処理と進捗通知
│   ├── history.js           オンチェーン履歴の取得と解析
│   ├── quests.js            クエスト定義・進行状況の保存・ランク計算
│   └── solana.js            Devnet 検証・SOL/lamports 変換などの共通処理
└── vendor/
    ├── solana-web3.min.js   @solana/web3.js v1.99.0 のブラウザ向けビルド（IIFE）
    └── solana-web3.LICENSE  同ライブラリのライセンス（MIT）
```

外部 CDN には依存せず、必要なライブラリは `vendor/` に同梱しています。

## 注意事項

- Devnet 専用です。Devnet の SOL に金銭的価値はありません。
- Devnet はリセットされることがあり、その場合は過去の取引や残高が消えます。
- ブラウザの localStorage を消去すると、クエスト設定と進行状況は初期化されます（オンチェーンの取引は残ります）。
