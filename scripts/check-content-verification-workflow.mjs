import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../docs/18-內容驗證審核流程.md', import.meta.url), 'utf8');
const required = [
  '# Content Verification：AI-first、例外人工確認',
  'AI-first',
  '`verified`',
  '`provisional`',
  '`exception`',
  '`disabled`',
  '每一個候選欄位必須保存：候選讀值、`status`、`confidence`、來源 ID、來源檔名、印刷頁碼或卡表區域、例外理由',
  '所有目前的 `baseProvisionalContentCatalog` 候選均為 `activation: disabled`、`runtimeLoadable: false`。',
  '不清楚的資料不猜測。',
  '## 素材與呈現隔離',
  '不提交或顯示官方圖片、掃描、卡面、美術或商標。',
  '仍不能自動把候選載入正式 production Content Pack。'
];
const missing = required.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) throw new Error(`Content verification workflow is missing required contract text: ${missing.join(', ')}`);
if (['![', '<img', '<object', '<embed', 'data:image'].some((fragment) => workflow.toLowerCase().includes(fragment))) throw new Error('Content verification workflow must not embed images.');
console.log('Content verification workflow check passed.');
