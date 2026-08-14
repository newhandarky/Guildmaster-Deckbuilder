# 四人離線 Provisional 能力門檻

## 模式定位

本模式固定標示為「基礎版原作衍生 Provisional 測試」。它是 1 名真人與 3 名 CPU 競爭的離線對局；四名玩家各自累積榮譽，並列第一視為共同勝利。它不是合作模式，也不得標示為官方完整基礎版。

CPU 僅能使用該玩家的 `PlayerView`、同 revision 的 Legal Commands、公開 action features 與版本化 profile。Strategy 不得取得 `GameState`、authoritative RNG、公共牌庫順序、其他玩家手牌或 owner-only counter。

## 內容與數位張數 policy

完整測試 pack 必須與 `base:provisional-foundation` 分離，使用 `base:provisional-original-full@0.4.0` identity。候選 roster 為 30 種冒險者、28 種物資、14 種魔物、11 名魔王與 30 張羈絆；協助者不是 baseline。

以下逐種類張數是 project policy，不是官方實體配置：

- 冒險者每種 2 張，共 60 張。
- 物資每種先 2 張，01／02／03 各加 1 張，共 59 張。
- 魔物 01 為 3 張；02／03／04 各 3 張；05–14 各 2 張，共 32 張。
- 魔王與羈絆每種 1 張。

Runtime 與 UI 只使用中性候選名稱。已由清楚卡面、既有通用能力與 focused tests 封口的 enabled effect 包含：候選冒險者 02 的配戴限制、09 的配戴中戰力 +1，候選物資 01／02／03／04／05／07／08／10／13／15／17／18／25／27，以及候選魔物 01／02／03／06／09／10／11／14 的擊敗獎勵。其餘未完成語意或 Engine 能力封口的文字只作 evidence，繼續帶 `playtest:effects-disabled`。決策來源以 [基礎版卡牌規則待確認問卷](./30-基礎版卡牌規則待確認問卷.md) 為準；能力批次見 [基礎版卡牌效果實作批次](./31-基礎版卡牌效果實作批次.md)。

## Machine-checkable gate

每個 runtime definition 必須可對應到 capability matrix entry，並具備 evidence status、copy policy、所需 Engine capability、decision kind、CPU resolver、test ID 與 enabled／blocked 狀態。

任一 effect 缺少 field evidence、Engine capability、CPU resolver 或 normal／zero-candidate／rollback／Snapshot 測試時，數值仍可載入測試基礎 deck-building 流程，但必須帶 `playtest:effects-disabled`，Presentation 必須明示效果未啟用。

## 完整對局阻塞清單

- 四人建局必須選足 6 名魔王，不得靜默縮短。
- 所有公共 ordered decks 必須是 hidden；只有公開列進入 Player View。
- final round 在起始玩家前一 seat 的 rest 完成後結束。
- 羈絆條件成立只產生可選 `COMPLETE_BONDS` Legal Commands；玩家可完成任意非空子集合或完全不送出。Engine 不得在討伐或休息邊界自動完成羈絆。
- 同分使用 competition ranking，例如 `1,1,3`。
- 完整 pack 使用羈絆抽 7 選 5 setup；每位玩家只看自己的 offer。
- 市場刷新、turn/phase lifecycle、turn facts、敵人報酬與所有 enabled mandatory choice 必須有權威 Command 路徑。
- CPU runner 一次只送出一個 Legal Command；達 guard 時回傳結構化 blocked，不得靜默停止。
- Save/Replay 必須綁定 pack、module、CPU profile/version 與 registry fingerprint。

## 第一版允許的保守降級

尚未完成 field-level 覆核的卡效不會猜測實作。完整 roster可供抽牌、購買、戰鬥、榮譽與終局測試，但 `playtest:effects-disabled` 卡牌不會執行未確認能力；此差異必須持續顯示在 Provisional notice 與對局摘要。
