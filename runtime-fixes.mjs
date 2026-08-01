import fs from 'node:fs/promises';

const file = 'watcher.mjs';
let source = await fs.readFile(file, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return;
  if (!source.includes(oldText)) {
    throw new Error(`无法应用兼容修复：${label} 的目标代码不存在`);
  }
  source = source.replace(oldText, newText);
}

replaceOnce(
  "  const items = validateAndNormalizeItems(rows, '洛克万事屋');",
  `  const items = rows.map(item => {
    const name = String(item.name || '').trim();
    if (!name) return null;
    const price = Number.isFinite(item.price) && item.price >= 0 ? item.price : undefined;
    const limit = Number.isInteger(item.limit) && item.limit > 0 ? item.limit : undefined;
    return {
      name,
      priceRaw: item.priceRaw || (price != null ? String(price) : ''),
      price,
      limit,
    };
  }).filter(Boolean);
  if (!items.length) throw new Error('洛克万事屋未返回可识别的商品名称');`,
  '辅助源允许缺少价格或限购',
);

replaceOnce(
  `    if (main.price !== aux.price || main.limit !== aux.limit) {
      conflicts.push(\`“\${name}”价格/限购冲突：主源 \${main.price}/\${main.limit}，辅助源 \${aux.price}/\${aux.limit}\`);
    }`,
  `    const priceConflict = Number.isFinite(aux.price) && main.price !== aux.price;
    const limitConflict = Number.isInteger(aux.limit) && aux.limit > 0 && main.limit !== aux.limit;
    if (priceConflict || limitConflict) {
      conflicts.push(\`“\${name}”已提供字段冲突：主源 \${main.price}/\${main.limit}，辅助源 \${aux.price ?? '缺失'}/\${aux.limit ?? '缺失'}\`);
    }`,
  '辅助源仅校验已提供字段',
);

replaceOnce(
  "  const to = process.env.ALERT_EMAIL || '15862845902@163.com';",
  "  const to = process.env.ALERT_EMAILS || process.env.ALERT_EMAIL || '15862845902@163.com';",
  '支持多个收件人',
);

await fs.writeFile(file, source, 'utf8');
console.log('运行时兼容修复已应用或已存在。');
