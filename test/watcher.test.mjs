import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCH_ITEMS,
  crossValidate,
  normalizeArkmeng,
  parseLimit,
  parseOnebijiHtml,
  parsePrice,
  resolveExpectedSlot,
} from '../watcher.mjs';

function beijingTimestamp(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
}

test('default watch list is complete', () => {
  assert.deepEqual(WATCH_ITEMS, [
    '国王球',
    '棱镜球',
    '镜面相框',
    '炫彩蛋',
    '炫彩精灵蛋',
    '首领血脉秘药',
    '祝福项坠',
  ]);
});

test('resolves Beijing merchant slots', () => {
  assert.equal(resolveExpectedSlot(beijingTimestamp(2026, 8, 1, 8, 5)).label, '08:00-12:00');
  assert.equal(resolveExpectedSlot(beijingTimestamp(2026, 8, 1, 12, 5)).label, '12:00-16:00');
  assert.equal(resolveExpectedSlot(beijingTimestamp(2026, 8, 1, 16, 5)).label, '16:00-20:00');
  assert.equal(resolveExpectedSlot(beijingTimestamp(2026, 8, 1, 20, 5)).label, '20:00-24:00');
  assert.equal(resolveExpectedSlot(beijingTimestamp(2026, 8, 1, 3, 0)), null);
});

test('normalizes prices and limits', () => {
  assert.deepEqual(parsePrice('48w'), { raw: '48w', value: 480000 });
  assert.deepEqual(parsePrice('80万'), { raw: '80万', value: 800000 });
  assert.deepEqual(parsePrice('6,000'), { raw: '6,000', value: 6000 });
  assert.equal(parseLimit('限购 3'), 3);
});

test('parses complete onebiji product cards for the expected slot', () => {
  const now = beijingTimestamp(2026, 8, 1, 12, 5);
  const expected = resolveExpectedSlot(now);
  const serverNow = Math.floor(now / 1000);
  const html = `
    <script>var serverNow = ${serverNow}; var index = 2;</script>
    <ul class="time-list">
      <li data-index="1" class="check_1"><em>08:00</em><em>12:00</em></li>
      <li data-index="2" class="check_2 on"><em>12:00</em><em>16:00</em></li>
      <li data-index="3" class="check_3"><em>16:00</em><em>20:00</em></li>
      <li data-index="4" class="check_4"><em>20:00</em><em>24:00</em></li>
    </ul>
    <ul class="shop-list">
      <li class="show_2">
        <div class="gitem"><em>限购1</em></div>
        <p><em class="shop_name">国王球</em></p>
        <em class="shop_price">16w</em>
      </li>
      <li class="show_2">
        <div class="gitem"><em>限购5</em></div>
        <p><em class="shop_name">炫彩蛋</em></p>
        <em class="shop_price">80w</em>
      </li>
    </ul>`;
  const parsed = parseOnebijiHtml(html, expected, now);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0], { name: '国王球', priceRaw: '16w', price: 160000, limit: 1 });
  assert.deepEqual(parsed.items[1], { name: '炫彩蛋', priceRaw: '80w', price: 800000, limit: 5 });
});

test('allows an auxiliary source to be a consistent subset', () => {
  const primary = [
    { name: '国王球', price: 160000, limit: 3 },
    { name: '水系血脉秘药', price: 160000, limit: 3 },
  ];
  const auxiliary = [{ name: '国王球', price: 160000, limit: 3 }];
  const result = crossValidate(primary, auxiliary);
  assert.equal(result.ok, true);
  assert.equal(result.auxiliaryIsSubset, true);
});

test('detects auxiliary conflicts', () => {
  const primary = [{ name: '国王球', price: 160000, limit: 3 }];
  const auxiliary = [{ name: '国王球', price: 800000, limit: 1 }];
  const result = crossValidate(primary, auxiliary);
  assert.equal(result.ok, false);
  assert.match(result.conflicts.join('；'), /价格\/限购冲突/);
});

test('normalizes arkmeng merchant response', () => {
  const now = Date.now();
  const expected = resolveExpectedSlot(now);
  if (!expected) return;
  const p = new Date(now + 8 * 60 * 60 * 1000);
  const start = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), expected.startHour - 8, 0, 0, 0);
  const endHourUtc = expected.endHour === 24 ? 16 : expected.endHour - 8;
  const end = expected.endHour === 24
    ? Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() + 1, 0 - 8 + 8, 0, 0, 0)
    : Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), endHourUtc, 0, 0, 0);
  const result = {
    merchantActivities: [{
      start_time: start,
      end_time: end,
      get_props: [{ name: '祝福项坠', price: 800000, limit: 1, start_time: start, end_time: end }],
    }],
  };
  const normalized = normalizeArkmeng(result, expected);
  assert.equal(normalized.items[0].name, '祝福项坠');
  assert.equal(normalized.items[0].price, 800000);
});
