# Content Verification 人工確認流程

## 目的與邊界

本流程把候選層的 `needs-human-confirmation` 與正式 Content Pack 的 `verified`／`enabled` 分開處理。人工確認可以判定候選讀值是否清晰，但**不能**讓 image-only 視覺資料、OCR 結果、示範資料或推測直接成為正式卡牌的 `verified` 證據；在此情況下不得將任何卡牌欄位標成 `verified`／`enabled`。

每次只處理一張卡或同一張卡的一組欄位；不得因確認一個欄位而順帶啟用其餘欄位、效果、UI 或 runtime 載入。

## 角色與責任

- **內容負責人**：提出候選、填寫來源定位與逐欄候選值；不得自行核准自己的候選為正式資料。
- **確認 reviewer**：逐欄比對合法來源，記錄日期、來源頁碼／區域、結果與任何歧義；不得只以卡名相似或記憶核對。
- **Content Pack 維護者**：只有取得完整通過紀錄後，才建立正式 definition、field audit 與測試；不負責猜補缺欄位。

## 每張卡的最小核對欄位

下列欄位每一項都要有自己的來源定位；不適用時明寫 `n/a` 與原因：

1. 永久 namespaced definition ID、Content Pack／版本、官方名稱或明確的原創顯示名稱標記。
2. 卡種，以及適用時的職業／子類型。
3. 份數與供應／起始／替換關係。
4. 費用、購買力、戰力、榮譽。
5. 完整效果、目標、時序、持續時間、區域移動與例外規則。
6. 每個欄位的官方 URL、文件名稱／版本、頁碼或網站區塊、視覺頁面的精確區域，以及確認人與確認日期。

## 可稽核確認紀錄格式

每一列只確認一張卡的一個欄位，保存在 PR 描述、audit 資料或 review 附件的文字紀錄中；不提交原始圖片。

| candidateId / definitionId | 欄位 | 候選值 | 官方 URL／文件版本 | 頁碼／區域 | 內容負責人 | reviewer | 確認日期 | 結果 | 備註／缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `base:starter-candidate/maina` | `combat` | `1` | 官方規則書／版本資訊 | 印刷頁 3；指定卡片區域 | `<owner>` | `<reviewer>` | `YYYY-MM-DD` | `needs-human-confirmation` | `待獨立來源或正式 audit` |

結果只能使用下列值：`confirmed-candidate`、`verified-for-formal-audit`、`ambiguous`、`conflict`、`rejected`。`verified-for-formal-audit` 表示「可開始填入正式 audit」，不是直接將 runtime 內容設為 `enabled`。

## 狀態轉換與啟用門檻

| 起始狀態 | 目標狀態 | 必要條件 | 禁止事項 |
| --- | --- | --- | --- |
| `todo` | `needs-human-confirmation` | 有候選值、合法來源定位、內容負責人和待 review 記錄。 | 不得產生正式 definition 或 runtime 載入。 |
| `needs-human-confirmation` | `verified`（正式 audit 層） | 每個最小欄位都有可稽核官方文字／可驗證來源，且由不同 reviewer 確認；視覺來源只可輔助定位，不能單獨支援正式 `verified`。 | 不得只因單張視覺頁清晰就升格。 |
| `verified` | `disabled` | 完成正式 definition 與 field audit，但尚未準備啟用、仍待整包測試或產品決策。 | 不得把 `disabled` 宣稱為可遊玩的正式內容。 |
| `verified` + `disabled` | `enabled` | 所有必要欄位 verified、Content Pack dependencies／conflicts／replacements 通過、content audit 驗證與規則測試通過，且維護者明確核准。 | 不得以部分欄位 verified 或候選狀態啟用。 |
| 任意 | `todo` + `disabled` | 證據模糊、衝突、來源撤回或 reviewer 不同意。 | 不得保留先前讀值作隱性預設。 |

`disabled` 是載入狀態，`todo`／`needs-human-confirmation`／`verified` 是證據狀態；兩者不能互相替代。候選 catalog 的 validator 永遠拒絕 `verified` 與 `enabled`。

## 模糊、衝突與退回

1. 將該欄位標為 `ambiguous` 或 `conflict`，附上兩個讀值／來源定位；不得自行選較像的答案。
2. 將正式 audit 回退為 `todo`／`disabled`，或讓候選維持 `needs-human-confirmation`。
3. 在 `docs/09-open-questions.md` 新增或連結 open question；需要時請內容負責人提供更清晰、合法且可定位的文字來源。
4. 保留原確認紀錄與退回原因，待新來源到位後以新的確認日期重新 review。

## 顯示文字與素材隔離

- 不提交、嵌入或在前端載入官方圖片、掃描、卡面或美術。
- 原始來源的卡名、規則文字、數值與來源定位屬 content audit 資料；玩家顯示文案使用獨立的 localization／placeholder 層，不可自動複製原始效果文字或美術路徑。
- 即使正式資料已核對，玩家 UI 仍使用原創或占位視覺素材；來源證據不得成為 asset pipeline 的輸入。

## 批次確認清單

每批 PR 使用下列簡表，將一張卡的一組欄位交給使用者確認：

| 卡片候選 | 本批欄位 | 來源頁碼／區域 | 目前結果 | 需要使用者確認 |
| --- | --- | --- | --- | --- |
| `<candidateId>` | `name, copies` | `<page / region>` | `needs-human-confirmation` | 候選讀值是否與合法原件一致？ |
| `<candidateId>` | `cost, combat, honor` | `<page / region>` | `todo` | 是否可提供清晰頁面或官方文字來源？ |
| `<candidateId>` | `effect, timing` | `<page / region>` | `todo` | 是否有對應 FAQ／勘誤與完整效果文字？ |
