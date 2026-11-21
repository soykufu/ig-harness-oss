# 採用DM共通台帳の組込み条件

## 今回の実装範囲

`recruitment-outbound-ledger.ts` と追加マイグレーション0028は準備用の独立モジュールです。
**送信境界への任意組込みを追加しましたが、現在は無効・未配置です。定期実行への操作ID割当ても未完です。**
Webhookのecho専用取込は後述の明示設定でのみ有効になり、現在は無効です。
本番の準備ロック、送信停止、既存担当の実行所有権は変更しません。

- D1の単一SQLで通数照合と予約を一緒に実行し、同一アカウントの直近60分 `(現在-60分, 現在]` を最大10通に制限します。
- 操作キーはアカウント単位で一意です。既存キーは送信許可を再発行しません。
- API送信IDと手動/自動送信のechoを同じメッセージIDで照合し、両者を二重加算しません。API応答よりechoが先に届いても照合できます。
- 不明な送信結果は `uncertain` にし、新たな予約を止めます。echo未着だけを根拠に解除する機能は設けていません。
- 60秒以上取り残された予約、未来時刻の台帳、所有権の不一致、照合証跡の欠落/鮮度不足、停止設定の欠落は送信許可を出しません。
- echo処理は送信側のIGアカウントIDを照合し、本文/宛先をこの台帳へ保存しません。受信日時更新やシナリオ起動も行いません。

ローカルSQLiteの同時25予約テストでは10件だけが成功しました。Cloudflare上の複数実行環境での競合試験、Meta実機試験は未実施です。ネイティブアプリの手動送信自体をこの台帳から止めることはできません。

## 次の組込み手順（送信停止を維持したまま）

### 追加した署名済echo取込（未配置・設定無効）

`RECRUITMENT_ECHO_INGESTION=1` の場合のみ、既存POST /webhookのHMAC/正確なentry ID/App照合後に専用処理へ渡します。通常の受信キューとは分け、0028の観測表へ本文/宛先を保存せず直接永続化します。送り手/受け手/送信ID/発生時刻を検査し、echoだけの通知では送信用クライアントやスケジューラーを起動しません。送信停止中も取込可能ですが、不完全な取込を成功で応答せず、削除ロック中は503、書込失敗は500とします。再送はIDで重複排除します。

設定を有効にする前に0028適用とMeta実データの適合を確認してください。受信1件だけで台帳全体が新鮮とは言えないため、この処理から `reconciled_at_ms` は更新しません。署名済HTTP試験は通ってもMetaの手動送信捕捉は未検証です。事業アカウントの正式なデータ削除時はこの3表も同じアカウント範囲だけ削除します。

1. 既存担当と新担当の共有所有権、既存送信履歴、結果不明操作の有無を照合する。確認不能なら旧担当を変更せず保留する。
2. 署名検証済みWebhookのecho専用経路を用意する。通常受信への流し込みは禁止。送信者=対象IGアカウント、受信者=対象スレッドの照合を行い、テキスト/画像/テンプレート/プライベート返信についてMetaの実データで送信IDを照合する。
3. 既存の `eventKey()` はechoを除外しているため、単に除外を外さない。専用キュー、署名・再送・アカウント分離試験を追加し、`last_inbound_at` が延びないことを実機でも確かめる。
4. 手動DMを含む履歴が共有台帳へ届く範囲、遅延、欠落の検知方法を検証してから `reconciled_at_ms` の更新処理を接続する。タイマーだけで証跡時刻を更新しない。この表には既定で制御行を作らない。
5. `getAccountClient` の各実メッセージ送信に予約→送信→応答ID照合を接続する。複数のメッセージを送るrich messageは、外側の1操作を1通と数えず実メッセージ単位で予約する。識別不能な応答、通信切断、未知のGraph失敗は不明として停止する。
6. 送信停止と準備ロックに加え、8〜21時、返信可能時間、停止/辞退/有人対応、テンプレート版と配布許可を送信直前に再照合する。台帳の予約成功だけで送信してはいけない。
7. テスト用本人アカウントで停止・通数・有人引継ぎ・重複イベント・複数実行環境・再起動を検証し、必要な本人認証後にのみ切替を検討する。

## 既知の未完

### 手動返信入口の操作ID

`GET /api/friends/:id/manual-delivery-status` はowner/admin限定の照合用です。POSTと同じ `Idempotency-Key` をヘッダーで渡し、本人アカウント・宛先・操作IDの組合せだけを読みます。API呼出し、設定変更、旧データ補完、枠解放、再送はしません。確認画面の「送信結果を確認」もこのGETだけを実行します。処理完了intentと全送信枠の同一epoch・API応答ID・台帳記録が揃った場合だけ記録上の完了とし、確認待ちnonceを端末から除きます。不明・欠落・部分完了は保持します。HTTP 404/503やecho欠落を未送信の証拠とは扱いません。

現行観測表はAPI応答とechoを同じ表に保存するため、観測行があってもecho到着・相手への到達・既読を証明しません。0030の専用表で新たに記録された署名済みechoだけを区別し、到達・既読は引き続きunknownと返します。UIにもその限界を表示します。新しい送信IDを生成する操作や不明解除機能はありません。DDL0028/0029/0030未適用の環境では照合を503で保留します。この照合機能も未配置です。

強制台帳モードの手動返信POSTは `Idempotency-Key` を必須にし、アカウント単位の操作キーを宛先follower/本文/type/altTextのハッシュへ固定します。初回claimだけが送信へ進み、同じ操作の送信済み結果は再送せず返し、本文/宛先違いは409、処理中/不明も409で人の照合を待ちます。API成功後のログ保存に失敗した場合も新しい送信を開始しません。

追加DDL0029は本文やraw nonceを保存せず、正式なデータ削除ではこの記録も対象になります。claimed/uncertainが残る間は削除を保留します。管理画面は送信前にnonceと本文ハッシュだけをsessionStorageへ保存し、成功するまで同じ操作に使います。失敗後の内容変更は止め、記録済み成功の再取得では履歴を再読し、表示を二重追加しません。ブラウザストレージ消去/別端末での新操作との同一性はこれだけでは証明できません。

このAPI接続/画面変更も未配置です。強制モード無効時の旧APIは従来動作であり、この保証が本番に適用済みとは言えません。broadcast/シナリオ/comment/form/webhookの安定キーと相談・辞退状態の接続は別残件です。

### 実メッセージ境界への任意組込み

SDKはtracking変換・リンク生成・appsecret proof・本文シリアライズが終わった後、実fetch直前に `beforeFetch` を呼びます。この段階でも停止/準備ロック、8〜21時、IGアカウント有効、所有権epoch、照合/予約の鮮度、削除ロック、不明操作、手動送信を含む通数を再確認します。通常DMは対象アカウントのIGSIDに一致する既存followerを照合し、standby/最終受信24h外/未来の受信日時/削除済みも拒否します。送信echoを最終受信へ変換することはありません。

変換待ち中の条件変化で拒否した予約も、現段階では自動解放せず保守的にuncertainへ保留します。この状態を実送信が起きた証拠とは扱いません。private replyはcomment ID宛なので通常24h確認から分け、コメント期限/一度限り制約の最終再照合は別の接続残件です。相談/辞退/同意の業務状態と各入口の安定キーも未接続のままです。

`RECRUITMENT_LEDGER_ENFORCEMENT=1` のときだけ、`getAccountClient` はSDKのメッセージ送信境界にライフサイクル処理を組み込みます。操作キー/所有権epochを指定しない既存経路は送信不可です。各実メッセージで停止/8〜21時/所有権/鮮度/原子的枠確保→送信→送信ID/宛先照合を行います。richの各パーツは別枠です。送信ID不明、通信切断、宛先不一致、成功記録失敗は不明状態として止め、新しい操作にも進ませません。再試行用に別の操作キーを作ることは禁止です。

このモードでは枠確保前に既読/入力中を出さないため、presence装飾を適用しません。送信後のSDK観測コールバックとは異なり、台帳の成功記録失敗は黙殺しません。予約/不明操作が残る間は正式な事業アカウント削除も保留します。

既存のbroadcast/シナリオ/手動送信等の各入口には、安定した操作キーと業務の停止/同意/24h/private reply条件の接続が残ります。このフラグを有効にするだけで既存配信が利用可能になるわけではありません。現在の送信停止1/準備ロック1/フラグ未設定を維持します。

全送信経路への組込み、実Meta echoの検証、旧台帳移行、署名付きIG→LINE受渡しの実機確認は残っています。
この追加だけを「手動を含む本番通数制御完成」や「見学率向上」とは扱いません。


### 署名済みechoの出所（0030・準備実装）

署名検証・entry/account/App照合が済んだWebhookのopt-in入口だけが `recruitment_echo_receipts` を書きます。API応答や旧混在観測からのバックフィルはありません。既存の通数観測と専用証拠行を同一D1 batchで保存し、証拠保存失敗時は通数観測もロールバックしてWebhookを成功扱いしません。account＋MIDで重複排除し、Metaの送信時刻・最初/最新の受信時刻だけを保存（本文/宛先の保存なし）。通数を二重加算せず、最終受信/24h窓/照合鮮度/不明結果は更新・解除しません。

読取照合は、対象操作の全MIDに専用証拠がある場合だけ `signed_webhook_recorded`、それ以外はunknownと返します。これは署名済みWebhookメタデータの保存証拠で、候補者への到達・既読や手動送信の完全捕捉を証明しません。正式な事業アカウント削除では対象accountだけ削除し、観測削除時にもFK cascadeで証拠を残しません。0030も未配置で、echoフラグ/送信停止は維持します。


### 採用業務状態の最終抑止（準備実装）

強制台帳モードの通常DMは、リンク変換等が終わった実fetch直前にfollowers.metadataのrecruitment_deliveryを再読する。state=active、owner_epoch一致、observed_at_msが未来でなく5分以内、valid_until_msが現在より後かつ観測から5分以内である必要がある。相談consulting・停止stopped・辞退declined・hold・欠落・不正JSON・期限切れ・未知の値はすべて保留。既存importにactiveを一括補完しない。この状態は同意/特典配布許可/24h窓/通数の代替ではない。

この記録を実際の相談/辞退/停止イベントから正規同期する処理・管理手順は未接続。コード追加だけで相談後停止が本番完成したとは扱わない。private replyは通常DMとは別経路で最終条件接続が残る。新フラグ無効・本番未配置・送信停止は維持する。


### 署名済み受信からの持続的な抑止（0031・未配置）

RECRUITMENT_INBOUND_SUPPRESSION=1の場合だけ署名/entry/account/App照合後に受信抑止を保存し、完了前にWebhookを200としない。相談テキストはconsulting、明確な停止・辞退はstopped/declined、未知のpostback・添付はholdとして有人確認へ。一般の会話を勝手に同意・配布許可へ変換しない。返信や再開という文字から自動復活しない。MID（無いpostbackは完全イベント）のハッシュでmessaging/standby再送を重複排除。accountと送信者の組合せのハッシュ・分類・時刻だけ保存し本文/生IGSIDは保存しない。候補者行の作成前にも保持。通常受信キューとは別で、最終受信や同意の更新ではない。

通常DMの最終送信判定はこの持続的抑止も再読する。metadataをactiveに戻すだけでは解除できない。個人削除時には対象subject_hashを消して再送防止キーだけを残し、同じWebhookの再送で個人対応を復元しない。事業account削除では当該account分を削除。解除/相談解決の認証済み手順・有人返信の限定許可と管理画面への表示は次の残件。新フラグ既定無効・未配置・送信停止を維持する。

### コメント返信の最終照合（準備実装）

強制台帳モードのprivate replyはcomment:<job-id>という安定操作キーと、同account/comment/followerのprocessing job・processing private_reply_attemptsを要求。コメント作成日時が既知かつ7日以内、liveでない、job期限/開始時刻/試行時刻/所有権・active metadata・持続的な相談/停止も最終再照合する。通常DMの24h窓を付け替えたりechoから開いたりしない。応答recipientも対応followerと照合。現物のjobにこのキーを渡す入口は未接続で、任意キーや時刻不明を通すものではない。既存の期限前Graph照会を理由に最終照合を省略しない。


### 受信保留の読取表示（未配置）

owner/admin限定GET /api/friends/:id/recruitment-holdsは、認証済みの対象accountと既存followerの組合せだけを読み、状態別件数/最古・最新時刻/needsReviewを返す。本文・生IGSID・イベントキー・subject_hashは返さない。個人削除済みsubjectなしのtombstoneは表示しない。応答はno-storeで設定補完や送信/解除を行わず、空でもmayResume=false。DB未適用/取得不能は503で0件とは扱わない。チャット画面へ確認待ち/記録なし/取得不能を表示し、会話切替時は以前の取得を中止する。実ブラウザ表示とMeta実機は未検証。人が相談へ返信する認証・操作単位の許可は次の独立残件。

### Comment job connection (2026-11-21, source only)

Enforcement mode now gives each claimed comment job a separate SDK client. The stable private phase key is `comment:<job-id>` and the post-inbound DM phase is `comment-dm:<job-id>`. Cron and queued-webhook entry points provide this factory. Each phase reads an existing, fresh harness owner epoch; it never refreshes reconciliation or generates an epoch. Client creation failure has no shared-client fallback. Existing SDK reservation, final guard, business state and inbound hold checks remain in force. The later DM retains its ordinary 24h requirement and cannot borrow the private reply's seven-day window. Completed jobs do not create another client.

The final private-reply gate check also requires the delivery's follower and IGSID to match the job's follower, `triggered` status, no end reason, and the same active account gate. A drop/completion/stop or changed destination during asynchronous preparation blocks the network call. Public comment replies and other broadcast/step/form paths are separate outstanding integrations. Missing Meta authentication, ownership evidence and business state synchronization remain blocking conditions. No enforcement flag or production send was enabled by this change.
