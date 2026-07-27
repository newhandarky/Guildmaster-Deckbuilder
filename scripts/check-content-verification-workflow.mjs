import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../docs/18-內容驗證審核流程.md', import.meta.url), 'utf8');
const required = [
  '## 角色與責任',
  '## 每張卡的最小核對欄位',
  '## 可稽核確認紀錄格式',
  '| candidateId / definitionId | 欄位 | 候選值 | 官方 URL／文件版本 | 頁碼／區域 | 內容負責人 | reviewer | 確認日期 | 結果 | 備註／缺口 |',
  '## 狀態轉換與啟用門檻',
  '## 模糊、衝突與退回',
  '## 顯示文字與素材隔離',
  '## 批次確認清單',
  'image-only 視覺資料、OCR 結果、示範資料或推測',
  '不得將任何卡牌欄位標成 `verified`／`enabled`',
  '視覺來源只可輔助定位，不能單獨支援正式 `verified`。',
  '任意 | `todo` + `disabled`',
  '不提交、嵌入或在前端載入官方圖片、掃描、卡面或美術。'
];
const missing = required.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) throw new Error(`Content verification workflow is missing required contract text: ${missing.join(', ')}`);
if (['![', '<img', '<object', '<embed', 'data:image'].some((fragment) => workflow.toLowerCase().includes(fragment))) throw new Error('Content verification workflow must not embed images.');
console.log('Content verification workflow check passed.');
