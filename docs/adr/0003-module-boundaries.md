# ADR 0003：模組邊界與依賴規則

- 狀態：Partially superseded by ADR 0004
- 日期：2026-07-26

## 背景

過往專案曾因缺少拆分規則，讓畫面、store、規則與卡牌效果逐步集中到少數超大檔案。單靠 code review 提醒不足以阻止同樣問題再次發生。

## 決策

採用 layer + feature modules：

- UI 以玩家流程切成 setup、board、party、combat、market、scoring、save-load。
- Domain 以 model、queries、effects、engine、content、ports 分層。
- 跨模組只透過 `index.ts` public API；依賴單向且禁止循環。
- `shell`、store、registry 與 `index.ts` 只做協調或組合，不承載實際規則。
- 使用 ESLint 與 dependency graph 自動檢查依賴、deep import、檔案大小與複雜度。
- 採用 `11-modularity-guidelines.md` 的 warning、硬門檻與具名例外流程。

## 影響

- 新功能初期需要先判斷 owner module 並設計 public contract。
- 小型變更可能涉及新增檔案，但單一檔案的修改理由更清楚。
- UI、規則引擎、AI 與未來 server adapter 可以獨立演進。
- CI 會阻擋循環依賴與未核准的超大型檔案。

## 不採用方案

- 只依靠資料夾命名：無法阻止 deep import 與反向依賴。
- 任意「每個函式一檔」：造成碎片化，沒有真正建立業務邊界。
- micro-frontend：MVP 規模不需要獨立部署多個前端。
- 本 ADR 原先暫不採 multi-package workspace；使用者確認完整目標包含擴充與線上對戰後，此部分由 ADR 0004 取代。其 feature/domain 內部模組原則仍有效。
