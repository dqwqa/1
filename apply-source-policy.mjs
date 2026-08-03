import fs from 'node:fs/promises';

const file = 'watcher.mjs';
let source = await fs.readFile(file, 'utf8');
let changed = false;

function replaceIfPresent(oldText, newText) {
  if (!source.includes(oldText)) return;
  source = source.replace(oldText, newText);
  changed = true;
}

if (!source.includes("const sourcePolicy = {\n      authoritativeSource: 'onebiji'")) {
  const auxiliaryRuntime = /    let auxiliary;\n[\s\S]*?\n\n    const items = primary\.first\.items;/;
  if (!auxiliaryRuntime.test(source)) {
    throw new Error('未找到远行商人辅助源运行代码，拒绝静默修改');
  }
  source = source.replace(
    auxiliaryRuntime,
    `    const sourcePolicy = {
      authoritativeSource: 'onebiji',
      auxiliarySources: [],
      note: '仅使用好游快爆实时商品卡片；未调用任何辅助数据源',
    };

    const items = primary.first.items;`,
  );
  changed = true;
}

replaceIfPresent('      auxiliary,\n', '      sourcePolicy,\n');
replaceIfPresent('    `- 辅助源：${status.auxiliary.status}`,\n', '');
replaceIfPresent('    `- 洛克万事屋：${ARKMENG_BASE_URL}/merchant`,\n', '');

replaceIfPresent(
  "  const marker = `roco-match:${status.slot.key}:${status.signature}`;",
  "  const marker = `roco-match:${status.slot.key}`;",
);
replaceIfPresent(
  "    `@${process.env.GITHUB_REPOSITORY?.split('/')[0] || 'owner'} 发现远行商人关注商品。`,",
  "    '发现远行商人关注商品。',",
);
replaceIfPresent(
  "  const issue = await createIssue({ title: `【远行商人提醒】${matched.map(item => item.name).join('、')}｜${status.slot.label}`, body, labels: [], marker });\n  const mail = await sendSmtpMail('洛克王国远行商人提醒：发现关注商品', body);\n  return { issue, mail };",
  "  const issue = await createIssue({ title: `【远行商人提醒】${matched.map(item => item.name).join('、')}｜${status.slot.label}`, body, labels: [], marker });\n  if (!issue.created) {\n    return { issue, mail: { sent: false, reason: 'duplicate merchant slot suppressed' } };\n  }\n  const mail = await sendSmtpMail('洛克王国远行商人提醒：发现关注商品', body);\n  return { issue, mail };",
);
replaceIfPresent(
  "  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];\n  const issue = await githubRequest('/issues', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ title, body: `${body}\\n\\n<!-- ${marker} -->`, labels, assignees: owner ? [owner] : [] }),\n  });",
  "  const issue = await githubRequest('/issues', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ title, body: `${body}\\n\\n<!-- ${marker} -->`, labels }),\n  });",
);

if (changed) {
  await fs.writeFile(file, source, 'utf8');
  console.log('已应用：仅使用好游快爆、停用洛克万事屋、每轮最多一封邮件。');
} else {
  console.log('单一数据源与单轮邮件去重策略已经生效。');
}
