import fs from 'node:fs/promises';

const file = 'watcher.mjs';
let source = await fs.readFile(file, 'utf8');

const oldBlock = `      const validation = crossValidate(primary.first.items, verified.first.items);
      if (!validation.ok) throw new Error(\`AUXILIARY_CONFLICT:\${validation.conflicts.join('；')}\`);
      auxiliary = { status: 'ok', itemCount: verified.first.items.length, validation, signature: verified.signature };
    } catch (error) {
      if (String(error.message || '').startsWith('AUXILIARY_CONFLICT:')) throw error;
      auxiliary = { status: 'unavailable', error: error.message };
    }`;

const newBlock = `      const validation = crossValidate(primary.first.items, verified.first.items);
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

if (source.includes(newBlock)) {
  console.log('实时主源优先策略已经生效。');
} else if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
  await fs.writeFile(file, source, 'utf8');
  console.log('已应用实时主源优先策略。');
} else {
  throw new Error('未找到预期的辅助源阻断逻辑，拒绝静默修改');
}
