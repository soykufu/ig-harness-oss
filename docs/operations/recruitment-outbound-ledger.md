# 採用DM共通台帳の組込み条件

## 承認文面を切らないtemplate準備（2026-11-21・本番未適用）

強制モードのCTA/後続button templateは、承認文面やlabelを黙ってsliceしない。既存のtitle/subtitle 80、button 20の保守的な予算を広げず、絵文字・国旗・結合文字をgrapheme境界で分け、全ての承認文字が収まる場合だけ送信計画へ進む。長すぎる本文/label、不正surrogate、文字を壊さず分割できない場合は保留する。画像付き後続でも最初の画像から送らない。旧モードの文面/送信は変更しない。

[Meta Generic template](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/generic-template)の構造/80文字制約を2026-11-21に確認。UnicodeのAPI受理をローカル試験だけで証明しない。実端末/Metaの受理は未検証で、機能/flagsを有効化しない。

## Form管理の保存・account照合（2026-11-21・本番未適用）

フォーム名だけの更新で、未指定のis_active/metadata保存/自動メッセージ/tag/scenarioを初期化しない。DB更新を指定された列だけの一文へ変更し、独立列の同時編集を上書きしない。明示null/falseは維持する。管理側update/delete/回答閲覧は選択accountと保存時の所有範囲を再照合し、別accountのtag/scenarioは作成/更新時のSQLでも拒否する。古い参照が別accountへ移ったフォームを再開せず、停止操作は可能とする。回答閲覧でも外部accountへ誤って関連した旧行を返さない。

文字列のfalseや不正なfieldsを設定値に変換しない。管理画面はaccount切替で旧一覧/回答を即座に隠し、古い取得を中止して新しいaccountの応答だけ採用する。取得失敗や応答形式不明を0件に変換しない。一覧未確認での操作と同一画面内の連続タップを抑止する。ブラウザ実表示/タップの実機確認は未了。public GET/submitの公開範囲と既存役割は変更せず、強制モードの回答は引き続きheldでプロフィール/tag/scenario/DMを実行しない。public friendId/IGSIDを本人認証と扱わず、認証元と回答者向け公開ページの接続は未了。本番のフォーム/LINE/資料受取条件は変更していない。

## 後続stepの不変receipt（2026-11-21・本番未適用）

0041は今後の強制モードだけに各account/delivery/stepの一意receiptを保存する。owner・定義・payload・予定数・claim時刻・claimed/sent/uncertainをmetadataと別に残す。旧配信を推定でbackfillしない。claim前の業務状態確認、claim/receiptの原子的保存、全slotのAPI受付/観測確認、receiptと次stepの原子的完了を組み合わせる。部分送信・保存失敗・定義/所有者/停止/相談/関係gate変更はuncertainを保持し、新しいIDで送らない。receiptが不明なら他経路の枠確保も拒否し、gate/本人データの削除で証跡を消さない。

読取レビューは保存済みの全step receiptを対象にし、旧metadataは最新claimだけ別表示する。旧owner欠落を補わず、API受付と閲覧/LINE登録は区別する。新receiptのない旧履歴から成功を作らない。最新ソース移行数は41、本番の直近実読取は18:46 JSTの27件（当時の40件に対して13件不足）であり、0041も本番未適用。停止1/準備lock1/追加flags無効・Meta未接続のまま。本番移行・配置は行わない。

## 停止中実環境の読取結果（2026-11-21 18:46 JST）

[既存read-only smoke run 44891150425](https://github.com/soykufu/ig-harness-oss/actions/runs/44891150425)は成功。指定D1の送信停止1/account0/follower0、移行台帳27件のname/hash一致を正規Actions内だけで確認した。最新ソース40件に対して不足は0028〜0040の13件、既適用ledgerの改変・不明将来移行・重複は0件。これはledger照合であり、未適用schemaの実体が利用可能という意味ではない。

実DBは変更していない。backup・既存配置bindings・準備lock・追加flagsの最新実証は今回の読取範囲外で、schemaReady=false/deploymentAuthorized=falseを維持する。Secrets値は取得/出力せず正規実行環境でのみ使った。配置/Meta認証/送信/LINEの実運用開始は行っていない。

履歴レビューは予定receiptと全slotをまとめて読み、100件のreceiptでもD1 query回数を8回以内に抑える試験を追加した。slot読取上限に達した場合は成功判定を止め、moreMayExist=true/照合待ちを維持する。取得件数上限は再送・保留解除の根拠にしない。

## 既存受入モデルとの整合（2026-11-21・参照実装のみ）

soykufu-recruitment-policyのquestion/visit/interviewは、停止・辞退・不明送信を解除せず有人キューへ回し、案内取消し・自動加入なしを明示する。これは送信許可ではなく、実際の有人返信は別の認証済み一回契約が必要。30日コホートは既存の実登録/実来店証拠と人の実施確認の条件を維持し、同じevent IDのcandidate/kind/日時/根拠/有人確認/社内テスト指定が食い違えば入力順で捨てず照合待ちにする。不正な時刻・無限の観察窓・空白だけの根拠を計測へ含めない。15受入試験は合格。実台帳04・LINE登録・実見学/面接の接続と実績照合は未実施で、率向上の証明ではない。

## 自動副作用と受信待ち再開（2026-11-21・本番未適用）

強制モードでは、DM受信後のscenario登録・帰属変更・外部連携に進む前にaccount/primary/owner鮮度/業務状態/新規hold/24h/配信窓/停止/結果不明/削除lockを確認する。停止・辞退・相談・不明状態でも受信履歴は保持するが自動案内を再開しない。scenario登録とawaiting-inbound解除はDB更新時にもsnapshotを再照合する。完了済みscenarioは再作成しない。08–21 JST外は受信queue/step/followup/comment/broadcastのclaim前で保留し、待機による送信結果不明を作らない。

署名IG→LINE受渡し・接続先mappingが未検証の間は、強制モードのDM/紹介ref/story返信/mention/comment/reactionを旧LINE接続へ転送しない。CONNECTの未署名本人紐付けと目的のないthank-you fallbackも保留する。公開mentionは受信記録を保ち専用の一回契約ができるまで返信しない。旧LINE転送の404探索以外は401/403（1010含む）/429/5xx/通信結果不明で別接続を試さない。これはLINE側の設定変更ではない。

## コホート計測の受入契約（参照計算のみ）

`recruitmentCohort`は候補者単位・最初の証跡付き実LINE登録から30日、観察期間が満了した登録者を共通分母にする。リンクclick/資料取得/予約/内定通知を実見学・実面接・採用確定と数えない。`visit_attended`/`interview_attended`/`hire_confirmed`は発生日、固有の業務証跡、人による実施/採用確定の確認が必要。`hire_confirmed`は採用決定と本人合意が確定した業務記録をアダプタで照合する契約で、内定通知や承諾click単独から作らない。現時点で実アダプタや台帳04へ接続していない。

| 返却値 | 分子 | 分母 |
|---|---|---|
| visitRate | 30日内の証跡付き実見学者 | 観察満了の実登録者 |
| interviewRate | 30日内の証跡付き実面接者 | 同上 |
| hireRate | 30日内の証跡付き採用確定者 | 同上 |
| interviewToHireRate | 実面接以後に採用確定した人 | 観察満了登録者中の実面接者 |

分母0はnull。未成熟登録・内部テストを率へ混ぜず、1人の複数eventを重複加算しない。同じevent IDまたは同種の同じ証跡IDが別人/日時/実施確認へ対応する場合は入力順で採用せず照合エラーにする。採用記録から面接実施を逆算しない。取消し・入社・定着はこの累積採用確定率とは別の実績で、計測値から推測しない。合成データの15受入試験は実登録数や率向上の証明ではない。

## CTAの固定操作ID・署名済み受信契約（2026-11-21・本番未適用）

初回キーワード/ストーリーメンション/コメント私信後の実返信からのCTAを、`gate-cta:<delivery ID>`で固定した専用clientへ接続した。0040にevent/account/deliveryごとの一意receiptを追加し、source hash・定義/テンプレート/宛先・payload hash/予定通数・owner・claim時刻を保存する。既存の処理中署名済みmessaging行と実sender/本文またはstory attachmentを確認する。caption等の単なるmentionや送信echoをCTA根拠にしない。コメント再開は同じ私信のAPI acknowledgementと同じownerの台帳、私信後の実inboundを必須とする。

claimは配信行の状態・元metadata・gate定義・担当・停止・削除lock・受信holdを同じbatchで照合し、一回だけ行う。SDKの各slot/fetch直前にも現source/定義/宛先/業務状態/受信hold/24h/送信窓/通数を再照合する。claim後の編集/相談/停止/受信行完了、部分送信、応答ID欠落、記録失敗はuncertainを保持し、新しいIDでやり直さない。強制モードのCTA失敗は、別scenarioやthank-you文面へfallthroughしない。

明示repeat=1でも同じ受信イベントの配信行は決定的なIDで一行へ収束し、別の実受信イベントでは新しいrepeat行を作れる。旧履歴は書き換えず、旧unique indexは再作成しない。CTAボタンpayloadの往復から特典受付までソース上で接続試験した。LINE連携は未検証の間、生成/代替URLへの迂回なし。旧textがtemplate上限を超える場合は黙って欠落させずclaim前に保留する。旧CTAや旧private replyに証拠を後付けしない。

0037〜0040・新送信モードは本番未適用。Meta/LINE/画面実機、旧台帳の実照合・率改善は未確認。配置停止/準備lock/追加flags無効・後続4通/20ルール無効を維持する。

## CTA初回の競合防止（2026-11-21・ソース準備のみ）

非repeatのgate配信行は存在確認とINSERTを単一SQLへまとめ、16同時呼出しでも新規行は一件だけにする。旧repeat履歴は書き換えず、削除済みのunique indexも再作成しない。明示allow_repeat=1の動作は維持する。DMキーワード/メンションの初回CTAも配信行を一回claimし、12同時呼出しで一件だけ進む。失敗/完了記録失敗はcta_send_status=uncertainとoutcome_unknownを保持し、別の入力で勝手に再送しない。停止中は送らない。

上記にSDK目的契約を追加したが、LINE受渡しやMeta実機は未検証のまま。競合防止だけを根拠に送信を許可しない。本人認証/実機を含め未検証条件を残したまま有効化しない。本番設定や既存運用は変更していない。

## 停止した配置のschema前提検査（2026-11-21・未実行）

既存soykufu-deployスクリプトは、設定ファイル書込・秘密値作成・wrangler deployの前に、D1の停止1/接続account 0、全40移行ファイルの実hashと適用台帳の完全一致、最新schema/索引の実物を読取で確認する。余分な将来移行・不足・改変・途中の停止/適用台帳変更は拒否し、勝手に移行・修復・再配置しない。この検査はbackupVerified=false/deploymentAuthorized=falseを返し、配置の承認やバックアップ検証の代わりにはしない。

現DB/backup/既存配置とbindingの最新照合、本番migration/配置/変更結果は依然未実施。検査はローカルの合成DBで確認しただけで、正規GitHub Actions環境へも今回起動していない。秘密値は取得/表示していない。既存deploy workflow自体は変更していない（そのworkflowファイルをmainへpushすると自動配置が起動する設定があるため、今後も証拠照合前に触らない）。

## 特典/フォロー確認の読取レビュー（2026-11-21・ソース準備のみ）

owner/adminだけがcampaign詳細から送信記録をGETで確認できる。account/gateの所有範囲を照合し、停止・準備ロック下でもDB読取だけを行い、Meta呼出し・再送・停止解除・受信保留解除を行わない。0039で今後のreceiptへ予定メッセージ数を保存する。旧receiptはNULLのまま、数を推定して成功にしない。全ての予定slot番号/同じowner/API acknowledgement/観測台帳とreceipt stateが一致した場合だけAPI受付の記録として表示し、業務側outcome_unknownは別に照合待ちを維持する。signed echoがあっても閲覧状況はunknown、mayRetryは常にfalse。空の履歴・404・schema欠落503も再送許可ではない。

画面は確認ボタンで最大50件だけを読み、別accountの古い応答を表示しない。本文・送信先IGSID・event key・Meta message ID・秘密値は返さない。receipt保存前に失敗した配信行の処理中/不明markerも照合待ちとして表示する。CTAと公開コメント返信を同画面へ接続済み。公開job識別子はhash化する。後続はmetadataに残る最新claimだけを表示し、旧claimのowner欠落を推定で補わない。全後続stepの不変receipt/履歴保存は別残件。この画面のブラウザ実機表示・タップは未検証で、本番配置前の確認が必要。

## Gateボタン返信の固定ID・受信根拠（2026-11-21・ソース準備のみ）

署名検証後の既存webhookキューで処理中のmessagingイベント（account・送信者・ボタンpayload・開始時刻が一致）だけを根拠にする。配信行をprofile GET前に一回claimし、0038のreceiptへevent key/対象/owner/定義版/描画payloadハッシュ/状態を保存する。特典は`gate-reward:<delivery>`で一回、リマインドは`gate-reminder:<delivery>:<loop>`で一回。同じクリックの再処理は次のloopへ進めず、別の実クリックは現在の段階として検証する。account内のevent keyと操作IDの一意性をschema実物で検査する。

SDKの各実送信前にreceipt・gate/テンプレートの本文/所有・配信段階/宛先・処理中イベント・owner・停止/準備ロック・業務状態/受信保留・24h/通数を再照合する。フォロー判定が不明なら未フォローとは扱わず保留し、max loops到達は送信ゼロのskipped receiptで終了する。全slotのAPI acknowledgementを記録できた場合だけ特典配信の業務段階を進める。部分送信・ID欠落・記録失敗・途中変更は自動再送/新IDでやり直さない。API受付は本人の閲覧/見学/面接の証拠ではない。

未検証LINE連携はリンク生成/別URL迂回なしで保留する。旧リッチ定義/PDF・本番設定・公開範囲・後続4通/20ルールは変更しない。CTAの初回/受信再開は上記0040の目的契約へ接続済み。受信根拠の無い直接呼出しに本番送信を許可しない。

削除APIも、進行中/結果不明のgate・receipt・公開/私信commentが残る場合は原子的に拒否し、解決前に根拠がcascade削除されることを防ぐ。account単位の削除も同じreceiptを確認する。新migrationとソースは本番未適用、Meta受信/表示・LINE実機は未検証。

## Gate後続メッセージの目的固定（2026-11-21・ソース準備のみ）

cronの後続DMは`gate-followup:<delivery ID>:<step index>`に固定し、画像/本文の実メッセージごとに共通台帳の別slotを使う。配信行のclaimに定義版・時刻を、全actionの準備後にpayloadハッシュをmetadataへ保存する。同じ配信を12処理が競合しても一件だけ進める。fetch直前に現gate/account/配信行/段階/宛先/claimの版と60秒以内の時刻を再照合し、通常の送信停止・準備ロック・24h・担当・通数・業務状態・受信保留も維持する。

全actionと署名付きボタンURLを最初の送信前に準備し、$&や差込記号を値として一回だけ展開する。本文/画像/宛先の違いや画像送信後の変更は残りを送らない。送信結果不明・応答ID欠落・完了記録の失敗は段階を進めず、同じIDで自動再送しない。完了直後の定義変更/停止/辞退を古い結果で上書きせず、次回予約を置かない。gateが結果不明の間は新規DMと削除を保留し、配信claimだけでまだDM slotがない間も削除を止める。

強制モードではLINE連携付き後続は署名受渡しの検証まで保留し、リンク自動作成やAPI拒否時の別URLへの迂回を行わない。CTAの初回/受信再開は上記0040の目的別IDへ接続済み。特典/リマインドは上記の署名済み受信receiptへ接続した。後続4通/20情報ルールの有効化、本番配置/Meta実機・LINE設定変更は行わない。

## 公開コメント返信の一回契約（2026-11-21・ソース準備のみ）

公開返信は`comment-public:<job ID>`に固定し、直前に成功した同じcomment/followerのprivate replyと同じowner epochのDM台帳を照合する。対象・文面・thread/mention・media・元DM本文・gateのハッシュを固定し、0037の追加列へclaim時の版・owner・時刻を保存する。署名処理後のfetch直前にも、現DBの停止・準備ロック・担当・業務状態・受信保留・削除ロック・gate・対象/文面/endpointを照合する。通常のDM枠へ公開返信を二重計上しない。

同時claimは一件だけ。公開返信がprocessing/uncertainの間は次のDM予約/実行と削除を保留し、結果不明・応答ID欠落・保存失敗を成功や新IDでの再送許可にしない。APIの公開返信IDを記録できた場合だけsentとする。旧記録は追加列NULLのままで、新しい根拠を付けない。実Metaでの公開表示・受信・返信検証と本番migration/配置は未実施。

## その他の非DM mutationの未接続経路（2026-11-21・ソースのみ）

公開コメント/mention/sender actionなどmessage lifecycleを通らないPOSTも、SDKの変換・署名処理後、fetch直前に停止/準備ロックを確認する。強制モードで目的別契約が未接続の非DM mutationは、別用途のkeyを渡しても拒否する。DM用のkeyだけで公開返信や他のmutationを許可しない。読み取りのGETはこのmutation用検査で送信扱いにしない。公開返信だけは上記の別契約を接続し、それ以外の目的が未接続のmutationは引き続き保留する。

## Rich test-sendの操作・目的固定（2026-11-21・ソース準備のみ）

テスト送信はowner/adminに限定し、強制モードでは同じ手動操作台帳のnonceに宛先・template/kind/全blocks・URL/username差込context・認証済みactorを固定する。SDKは各ブロックの生payloadを共通レンダラの期待値と照合し、fetch直前にテンプレート所有account/本文/操作者の現DB権限/同じclaimed intentを再確認する。通常の停止・準備ロック・24h・通数・受信保留・業務状態の条件は全て維持する。テンプレ変更や一部送信で失敗した操作はuncertainとし、新しい表現やIDで自動再送しない。完了再読でも全スロットの証拠件数が一致しなければ成功にしない。

SDKのリッチ描画は純粋な共通レンダラへ抽出し、文字データの$&やテンプレ風usernameを再展開しない。未対応・空・上限超過などは全ブロックを先に検査して初回ネットワーク前に拒否する。UIは一覧で選んだ宛先に限定し、表示時のテンプレート版をPOSTで照合する。nonce/本文ハッシュ/回答者内部ID/予定ブロック数をPOST前に端末へ保存し、確認待ちなら再送ボタンを止める。再読込後も同じnonceの読み取り照合だけを行い、全件の完了確認後に明示操作で別のテストへ進む。入力変更中・account切替・二重タップ・閉じた画面の非同期処理から新規送信しない。

ブラウザでの表示・タップ、Meta接続/実機と本番配置は未検証・未実施。画面操作の実確認を経ずに強制モードや送信停止を切り替えない。gate由来のrich送信などの目的別操作IDは別残件。

## Form安定受付ID・重複抑止（2026-11-21・設定無効／本番未適用）

追加0036は元のform_submissionsへ受付キーのハッシュ・回答内容/回答者のハッシュ・副作用保留状態を加え、form単位の一意索引を作る。強制モードではIdempotency-Keyが必須。同じIDの同じ回答は同じ回答行を返し、件数やプロフィール・タグ・シナリオ・DMを重ねて動かさない。本文や回答者が違う同じID、索引/列欠落、不明結果は照合待ちとし、新しいIDで自動再実行しない。キーはaccount/formに結び、nonce自体はDBへ保存しない。受付と件数更新は同じbatchで行う。

署名付き回答者認証は未接続なので、強制モードの受付は全てheldで保存し、全ての副作用を実行しない。停止解除だけでは再実行しない。画面には「本人確認待ち」と表示し、受付を自動配信成功と扱わない。既存の強制モード設定は無効のままであり、本番機能を有効にした変更ではない。索引の欠落・非一意化・列違いもmigration照合で拒否する。

## Form受付の土台と配信証拠の保護（2026-11-21・ソースのみ）

公開回答と一般metadata更新はrecruitment_deliveryを含む入力を拒否する。一般項目の保存もaccountと取得時metadataが一致する場合だけ更新し、別処理の新しい停止・辞退などを古い画面で上書きしない。formからプロフィールへ保存するのは定義済みの回答欄だけとする。公開formのfriendId/IGSIDヒントは所有accountと照合し、矛盾・別account・未所有form・不明な回答者は受付と全副作用の前に拒否する。これは本人性の証明ではなく、署名付き回答者認証と安定受付ID・重複抑止・送信直前の目的照合は引き続き必要。

追加migration0035はformsの不足列だけを加え、既存回答から件数を集計する。旧formのmetadata自動保存は既定0を維持する。CRUDはSQLite整数IDを発行し、form_submissionsの元のfollower_id/answers/submitted_atをAPIのfriend_id/data/created_atへ読み替える。識別済み回答の保存と件数更新を同一batchにし、別account・停止済みform・件数保存失敗では部分受付を残さない。元のNOT NULL回答者制約は維持し、匿名の疑似顧客や別の保存表を作らない。回答者向けの公開ページは未提供。migrationは本番未適用で、旧回答ID・本文・日時を保つ試験を追加している。

## Step差込元の最終照合（2026-11-21・ソースのみ）

stepの操作IDは従来のenrollment/stepで固定したまま、定義ハッシュとは別にaccount/IGSID/follower ID/表示名/usernameの差込元ハッシュを送信準備時に持つ。SDKのfetch直前に現DBを読み、欠落・変更なら送信しない。変更を新操作IDや再送許可にはしない。定期・即時keyword/referral経路とも同じ工場を通す。

DBのname列も名前差込に使い、互換display_name→name→usernameの順で解決する。JSON本文は値だけを展開して再エンコードし、引用符・改行・$&・テンプレ風の名前を文字データとして保持する。キーや別の差込へ再展開しない。作成済みの本文は展開前からJSONとして正しいことを確認する。実機送信や公開設定は変更していない。

## 確認付き有人返信の画面（2026-11-21・ソース準備のみ）

チャットの「相談に一回だけ返信する」は認証APIでowner/adminを確認した場合だけ表示する。宛先と本文の確認POSTと、一回だけ返信するPOSTを別ボタンに分け、Enterでは送らない。通常送信中は操作できず、確認画面を開いた間や確認待ちの返信がある間は通常送信も止める。アカウント切替時は一覧を再取得し、旧会話の画面と非同期処理を引き継がない。

確認はリクエスト開始から最大60秒。本文変更・期限切れ・宛先切替・再読み込みで送信許可を復元しない。端末にはaccount/follower/認証済みactor別のnonceと本文ハッシュだけを最初のPOST前に保存し、本文は保存しない。通信失敗・404・prepared・uncertainは再送の根拠にならず、同じnonceで読み取り照合だけを行う。API応答と完了証拠が一致した場合だけ端末の待機記録を取り除く。確認のみで期限切れになった記録も、自動で新しいnonceを発行しない。明示的な取り消しは、preparedかつ全送信スロットがゼロの同一account/follower/actor/nonceだけを単一SQLで永久失効する。キーは削除せず、claimと同時に成立しない。送信開始済み・sent・uncertain・削除処理中は拒否する。停止/準備ロック中でもこの無送信の操作は可能。取り消しの応答が不明ならGET照合だけを行い、失効の証拠が揃った後の明示的な「別の返信を作成」だけで新規本文へ進む。

Web側の状態遷移31試験と型検査で検証する。完了確認後の「別の返信を作成」も明示操作だけで行い、不明結果を捨てて新規送信には進まない。実ブラウザの表示・タップ・Meta実機は未確認。本番配置、停止解除、受信保留解除、自動案内再開は行っていない。

## 今回の実装範囲

`recruitment-outbound-ledger.ts` と追加マイグレーション0028は準備用の独立モジュールです。
**送信境界への任意組込みを追加しましたが、現在は無効・未配置です。主要経路の操作IDをソースへ接続済みですが、未接続のform送信・公開mention等は保留します。**
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

このAPI接続/画面変更も未配置です。強制モード無効時の旧APIは従来動作であり、この保証が本番に適用済みとは言えません。broadcast/シナリオ/comment/CTA・gate postbackの目的キーと業務状態はソースへ接続済みです。formの回答者認証/副作用、公開mention等の未接続目的は保留し、実機・配置・旧台帳照合は別残件です。

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

### Scheduled step operation connection (source preparation, 2026-11-21)

Cron steps now receive one client per claimed `step:<follower-scenario-id>:<step-id>`, using existing fresh owner evidence without fallback to the shared client. The SDK final boundary rechecks matching account/follower/scenario, active scenario/enrollment, the in-progress claim, NULL scheduling, and that this is still the next step. A stop, completion, ownership change or reordered/deleted step during async preparation cannot send. This is not a body-version attestation or consent synchronizer. Immediate webhook scenario entry points remain unconnected and therefore blocked in enforcement mode; broadcast/form/public paths are also outstanding.

Schema finding: the migrated schema lacks scenario_steps.condition_type/condition_value/next_step_on_false although the TypeScript CRUD references them. Do not claim conditional-step rechecks work. A trial test exposed the missing columns; that additional check was not shipped. Next address this explicit schema gap with additive migration and real schema/CRUD tests, then integrate condition/version checks. No live migration or flag was changed.

Follow-up in the same execution: additive 0032 now prepares the three missing condition columns, without rewriting any existing step. Final step admission reuses condition evaluation in strict mode: changed following/tag/metadata conditions, unknown types and missing required values cannot pass. Legacy evaluation semantics are retained outside enforcement mode. Migration and all new code remain unapplied to production. Separate existing editor CRUD/schema mismatches (UUID insertion into integer IDs and scenario description/trigger_tag_id fields) were also found and remain a concrete next audit item; this change is not full editor readiness.

The subsequent editor audit prepared additive 0033 description/trigger_tag_id columns and corrected createScenario/createScenarioStep to use the existing SQLite INTEGER primary keys with INSERT RETURNING instead of inserting UUIDs. Existing rows/IDs are preserved. A real migrated-schema test covers scenario creation, conditional step creation/update/readback and enrollment, with zero messages sent. Readiness now verifies these columns even if the migration ledger claims completion. This resolves the specific editor schema issues above; it does not constitute browser or production verification.

### Step version and immediate entry connection (source only)

Each keyed step client now receives a SHA-256 fingerprint of the prepared step definition (IDs, order, delay, type, raw body, condition and false branch). Immediately before the network request the actual definition is hashed again. Missing/mismatched evidence blocks the request. The durable operation key remains `step:<enrollment>:<step>`; editing the definition never mints another retry identity. The fingerprint is not plaintext content, consent, or a quota grant. Dynamic follower template values and whole-scenario versioning remain separate checks to consider.

Both referral and keyword immediate webhook step entry points pass the same per-operation factory as scheduled delivery. Primary, standby, paused and repeated-event tests cover the dispatcher: standby/paused do not create the sender; repeated events do not duplicate enrollment/sending. This does not enable flags, update production, lift inbound holds, or complete the human-reply contract. Other webhook auto-replies, gates, broadcast/forms/public replies are still separate outstanding paths.

### Broadcast operation connection (source only)

Scheduled and operator-triggered broadcasts pass a per-recipient client with stable `broadcast:<broadcast-id>:<follower-id>` identity and separate definition fingerprint (message type, body, tag filter). There is no shared-client fallback when authority or proof is missing. The SDK final check requires the matching account/follower, `sending` broadcast, a `processing` recipient with an attempt no older than 60 seconds, the same definition, and current account-owned tag membership if filtered. Existing normal-DM window, business-state, persistent holds, pause/preparation lock, owner and quota checks still apply. Completed/unknown operations cannot gain a fresh identity by editing the content. No actual broadcast or legacy-audience send was performed. Forms, other gate/auto-reply/public routes and the limited human-reply contract remain unfinished.

### Limited human reply contract preparation (source only, disabled in production)

0034 stores one short-lived reviewed text contract, binding actor ID, owning account/follower, stable nonce hash, body hash, existing owner epoch and the canonical full inbound-hold set. The latest signed intake must be consulting; a latest stop/decline/unknown or ambiguous tie cannot be reviewed as a reply. Earlier stop/decline records stay intact when a later consultation is reviewed. Empty/future/unavailable evidence is held. Claim and final validation require unchanged evidence, active owner/admin, fresh existing ownership, normal DM eligibility, no deletion lock, and explicit unpaused state. Concurrent claims permit only one winner; edits and retries do not overwrite an existing contract. No body/raw nonce is journaled. Account deletion explicitly removes contracts; follower deletion cascades.

POST /api/friends/:id/human-reply-review is owner/admin-only, only available in the still-disabled enforcement mode, and takes the actor from authenticated context, never request JSON. It performs review preparation only and responds maySend=false. It does not send, lift a hold, set active, mint ownership, or bypass the preparation lock. At the initial preparation checkpoint there was no UI button, claim/send route or SDK exemption; the subsequent connection is described below. Any subsequent integration must keep existing pause/preparation lock, hours/quota, one-block/recipient, response acknowledgement and uncertain-outcome handling, and must revalidate the contract immediately before fetch. The standalone claim/assert module is not proof of browser authentication or a live human reply.

Follow-up connection in the same execution: a separate owner/admin-only POST human-replies route consumes the existing review nonce/body/actor binding, builds one SDK text client, and retains the normal pause/preparation lock, hours, quota, owner and 24h guards. Enforcement remains off in production. The contract applies to exactly one text block and matching follower. Before transformation it verifies the raw reviewed text, and immediately before fetch it checks current contract, role, full inbound snapshot, expiry and ownership again. It provides a narrow exception to the automatic active-state/no-hold requirement for that reviewed action only; no suppression record or business state is altered. Success still requires the SDK's recipient-bound message acknowledgement and journal write. Failure/unknown remains consumed, with no automatic retry. Token refresh is excluded from this bounded operation. At that connection checkpoint there was no browser UI control or status view; readback is described below; the API/SDK tests do not establish browser/live readiness.

Deletion coordination follow-up: the deletion route now treats claimed/uncertain human reply contracts as busy work, alongside the existing manual-intent and outbound ledger checks. Prepared contracts do not authorize a send and can be removed with the scoped follower. This is conservative retention until outcome reconciliation, not an automatic release mechanism.

Human reply outcome readback: GET human-reply-status is owner/admin-only and binds the same account/follower/authenticated actor/nonce. It reads contracts and the sole outbound slot without creating defaults, sending, releasing capacity, retrying or clearing holds. Only sent contract plus same-epoch sent slot with message ID yields apiAcknowledged=true. Recipient receipt remains unknown and mayRetry=false for every result. Missing records/schema and a mismatched epoch cannot mean unsent. The source-only browser controls are described at the top; neither browser verification nor live deployment is established.

### Reviewed rich copy: preserve or hold (2026-11-21)

Enforced gate CTA/reward/reminder and authenticated rich-test purposes now use `renderRichActions(...,{preserveCopy:true})`. After context substitution the complete card title/subtitle/button, text and quick-reply title must fit the renderer's existing conservative UTF-16 budgets (80/80/20/1000); malformed surrogate pairs are rejected. Every source block is rendered and checked before a transport plan is returned. This leaves the legacy renderer default unchanged and makes no claim about untested Meta Unicode accounting.

Rich-test readiness additionally validates the entire current source definition, current recipient and bound context before reserving the first SDK transport slot. Thus a too-long second block cannot cause a first-block-only partial test. CTA rejects before its operation claim; reward/reminder retains a conservative uncertain receipt if its existing claim precedes rendering, and never retries with a new ID. Unit/integration tests use mocked Graph transport: zero calls prove a local hold, not actual recipient delivery.

### Abandoned claimed purpose receipts (2026-11-21)

An interrupted gate purpose can retain `claimed` before any SDK slot is reserved. The account-wide ledger now holds new reservations and the final transport check if CTA, reward/reminder or follow-up claims are 60 seconds old, future-dated or belong to a different ownership epoch. The same condition is bound into automation admission, mutation predicates and atomic scenario enrollment. Fresh current-owner claims retain normal operation; settled historical receipts do not block an account. Checks do not rewrite, refresh, release or retry any receipt. Synthetic tests cover all three receipt tables, the exact timeout boundary, owner mismatch, unchanged evidence and other-account isolation.
