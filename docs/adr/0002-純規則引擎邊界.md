# ADR 0002：純規則引擎邊界

- 狀態：Accepted
- 日期：2026-07-26

## 背景

桌遊數位化最常見的風險，是規則分散在按鈕 click、動畫 callback 與 store mutation，導致難以測試、AI 無法重用、連線時無法建立權威狀態。

## 決策

所有對局狀態只能由 `packages/game-engine` 的純 TypeScript 引擎透過 command 改變。引擎接收完整 state、CommandEnvelope、驗證完成的 ContentRegistry 與 RNG context，回傳新 state、events、pending choice 或結構化錯誤。

## 限制

- 引擎不得 import React、Zustand、DOM、localStorage 或網路 API。
- 引擎不得 import `apps/*` 或任何具體 content pack。
- 引擎不得直接呼叫 `Math.random()`、目前時間或全域 singleton。
- UI 不得直接 splice 牌庫、修改戰力或標記羈絆完成。
- server 與 AI 也不得重寫或繞過引擎規則。
- 動畫開始／結束不決定規則是否成功。

## 影響

- 初期需要較多 model 與 command boilerplate。
- 規則可用固定 seed 快速測試與重播。
- AI、教學、除錯工具與未來伺服器可共享同一 API。
- 存檔格式更穩定，也能在 restore 時驗證不變條件。
