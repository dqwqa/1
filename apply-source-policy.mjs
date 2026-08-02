import fs from 'node:fs/promises';

const file = 'watcher.mjs';
let source = await fs.readFile(file, 'utf8');
let changed = false;

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return;
  if (!source.includes(oldText)) {
    throw new Error(`未找到预期代码：${label}`);
  }
  source = source.replace(oldText, newText);
  changed = true;
}

const oldAuxiliaryBlock = `      const validation = crossValidate(primary.first.items, verified.first.items);
      if (!validation.ok) throw new Error(\`AUXILIARY_CONFLICT:\${validation.conflicts.join('；')}\`);
      auxiliary = { status: 'ok', itemCount: verified.first.items.length, validation, signature: verified.signature };
    } catch (error) {
      if (String(error.message || '').startsWith('AUXILIARY_CONFLICT:')) throw error;
      auxiliary = { status: 'unavailable', error: error.message };
    }`;

const newAuxiliaryBlock = `      const validation = crossValidate(primary.first.items, verified.first.items);
      auxiliary = {
        status: validation.ok ? 'ok_reference' : 'conflict_ignored',
        authoritative: false,
        note: validation.ok
          ? '辅助源仅供参考；最终结果以好游快爆实时商品卡片为准'
          : '辅助源与好游快爆实时主源不一致，已忽略辅助源，不阻断本轮商品判断',
        itemCount: verified.first.items.length,
        validation,
        signature: verified.signature,
      };
    } catch (error) {
      auxiliary = {
        status: 'unavailable_ignored',
        authoritative: false,
        note: '辅助源不可用或轮次过期，已忽略；最终结果以好游快爆实时商品卡片为准',
        error: error.message,
      };
    }`;

replaceOnce(oldAuxiliaryBlock, newAuxiliaryBlock, '辅助源只作参考');

replaceOnce(
  "  const marker = `roco-match:${status.slot.key}:${status.signature}`;",
  "  const marker = `roco-match:${status.slot.key}`;",
  '按轮次去重提醒',
);

replaceOnce(
  "    `@${process.env.GITHUB_REPOSITORY?.split('/')[0] || 'owner'} 发现远行商人关注商品。`,",
  "    '发现远行商人关注商品。',",
  '移除 GitHub 提及通知',
);

replaceOnce(
  "  const issue = await createIssue({ title: `【远行商人提醒】${matched.map(item => item.name).join('、')}｜${status.slot.label}`, body, labels: [], marker });\n  const mail = await sendSmtpMail('洛克王国远行商人提醒：发现关注商品', body);\n  return { issue, mail };",
  "  const issue = await createIssue({ title: `【远行商人提醒】${matched.map(item => item.name).join('、')}｜${status.slot.label}`, body, labels: [], marker });\n  if (!issue.created) {\n    return { issue, mail: { sent: false, reason: 'duplicate merchant slot suppressed' } };\n  }\n  const mail = await sendSmtpMail('洛克王国远行商人提醒：发现关注商品', body);\n  return { issue, mail };",
  '重复轮次不再发送 SMTP',
);

replaceOnce(
  "  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];\n  const issue = await githubRequest('/issues', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ title, body: `${body}\\n\\n<!-- ${marker} -->`, labels, assignees: owner ? [owner] : [] }),\n  });",
  "  const issue = await githubRequest('/issues', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ title, body: `${body}\\n\\n<!-- ${marker} -->`, labels }),\n  });",
  'GitHub Issue 不指派用户',
);

if (changed) {
  await fs.writeFile(file, source, 'utf8');
  console.log('已应用：主源优先、每轮最多一封邮件、静默去重。');
} else {
  console.log('主源优先与单轮邮件去重策略已经生效。');
}
