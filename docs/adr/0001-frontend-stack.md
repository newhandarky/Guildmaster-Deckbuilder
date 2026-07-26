# ADR 0001：前端技術選型

- 狀態：Accepted
- 日期：2026-07-26

## 背景

專案是卡牌數量多、狀態轉換密集、需要大量規則測試的網頁遊戲。第一版為離線 hot-seat，完整目標包含 AI 與線上對戰。本 ADR 僅決定 web client 技術，不決定 server runtime。

## 決策

採用 TypeScript、React 與 Vite。跨畫面 application state 使用 Zustand；內容 runtime validation 使用 Zod；測試使用 Vitest、React Testing Library 與 Playwright；樣式採 Tailwind CSS 搭配專案 design tokens。

## 理由

- TypeScript 的 discriminated unions 適合卡種、command、event 與效果 schema。
- React 生態成熟，適合大量互動狀態與響應式卡牌介面。
- Vite 啟動與測試整合簡單，不需要為 MVP 引入 SSR 框架。
- Zustand 可當薄 adapter，不迫使純規則引擎依賴 UI framework。
- Zod 可在內容載入與存檔恢復時阻擋不合法資料。

## 影響

- 核心規則必須維持 framework-agnostic。
- React/Vite 僅存在於 `apps/web`；共享 packages 不依賴它們。
- 不使用 Next.js 作為 MVP 預設，因為沒有 SEO、server rendering 或 API route 需求。
- 套件版本由 lockfile 管理；升級需通過規則回歸測試。
