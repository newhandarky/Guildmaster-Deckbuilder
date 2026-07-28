# 基礎版 Provisional 內容盤點

本盤點實作於 `packages/content-base/src/provisional/base-provisional-catalog.ts`，僅是可稽核候選資料，不是正式 runtime Content Pack。來源均為使用者合法提供的本機視覺資料及官方網站文字；圖片未提交至 repository。

## 覆蓋範圍

| 類別 | 候選數 | 來源 | 狀態 |
| --- | ---: | --- | --- |
| 起始內容 | 7 | 規則書印刷頁 3、`card-07.jpg` | 起始區域與基本數值 provisional；未印出的欄位不推測 |
| 冒險者 | 30 種／總數 60 | `card-01.jpg`、規則書印刷頁 2、4 | 名稱、費用、戰力、榮譽、職業與效果 provisional |
| 物資 | 28 種／總數 59 | `card-03.jpg`、規則書印刷頁 2、4 | 種類、費用、卡面效果 provisional；每種份數是唯一 remaining exception |
| 魔物 | 14 種／總數 32 | `card-05.jpg`、規則書印刷頁 2、5 | 戰力、購買力、榮譽與結算效果 provisional；每種份數是唯一 remaining exception |
| 魔王 | 11 | `card-04.jpg`、規則書印刷頁 2、5、官方 FAQ | 數值與效果 provisional；巴風特／奇美拉 FAQ 補充欄位 verified |
| 羈絆 | 30 | `card-02.jpg`、規則書印刷頁 2、5 | roster、條件與榮譽 provisional |
| 協助者 | 12 | `card-06.jpg`、規則書印刷頁 2、11 | roster、各一張與效果 provisional |

## 對局規則交叉結果

- 個人牌庫只在抽牌過程中空且仍要繼續抽時重洗；查看／展示牌庫頂不重洗。
- 道具結算後留在使用區，休息時才棄至棄牌堆（FAQ 勘誤）。
- 神樂的「查看」修為「展示」；巴風特與奇美拉採官方 FAQ 補充；修爾蒂自身不吃自身的第一位加成。
- 以上規則會保留在規則文件／Rules Module，並不因候選 catalog 而自動寫進 UI 或 production runtime。

完整欄位、來源定位、confidence 與 exception reason 由 TypeScript catalog 驗證；請見 [例外清單](./26-基礎版Provisional例外清單.md)。

## Playtest 裝配狀態

目前 catalog 的逐種份數仍是唯一資料 exception，且 effect DSL／協助者 adapter 尚未實作；因此不能成功裝配完整基礎版 playtest Content Pack。裝配器會明確拒絕，而不會忽略卡牌效果或產生錯誤的起始配置。後續可只選擇 exception 全數解決、且 mechanics adapter 已支援的子集合，經 `assembleProvisionalPlaytestPack` 建立 `provisional-playtest` pack；它預設也會被 runtime registry 拒絕，除非測試／內部 playtest 明確 opt-in。
