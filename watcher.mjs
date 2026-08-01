import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

export const WATCH_ITEMS = Object.freeze([
  '国王球',
  '棱镜球',
  '镜面相框',
  '炫彩蛋',
  '炫彩精灵蛋',
  '首领血脉秘药',
  '祝福项坠',
]);

const ONEBIJI_URL = 'https://www.onebiji.com/hykb_tools/comm/lkwgmerchant/preview.php?id=1&immgj=0';
const ARKMENG_BASE_URL = 'https://arkmeng.cn';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const FRESHNESS_MS = 20 * 60 * 1000;
const STATUS_DIR = path.resolve('status');
const LATEST_PATH = path.join(STATUS_DIR, 'latest.json');
const NOTIFIED_PATH = path.join(STATUS_DIR, 'notified.json');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function beijingParts(nowMs = Date.now()) {
  const d = new Date(nowMs + BEIJING_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatBeijing(nowMs = Date.now()) {
  const p = beijingParts(nowMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function resolveExpectedSlot(nowMs = Date.now()) {
  const p = beijingParts(nowMs);
  let index = 0;
  let startHour = 0;
  let endHour = 0;
  if (p.hour >= 8 && p.hour < 12) [index, startHour, endHour] = [1, 8, 12];
  else if (p.hour >= 12 && p.hour < 16) [index, startHour, endHour] = [2, 12, 16];
  else if (p.hour >= 16 && p.hour < 20) [index, startHour, endHour] = [3, 16, 20];
  else if (p.hour >= 20) [index, startHour, endHour] = [4, 20, 24];
  else return null;

  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return {
    index,
    startHour,
    endHour,
    label: `${pad(startHour)}:00-${pad(endHour)}:00`,
    key: `${date}-${pad(startHour)}`,
    date,
  };
}

function decodeHtmlEntities(text) {
  const map = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  };
  return String(text || '').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, entity => map[entity] || entity);
}

function stripTags(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractAttr(attrs, name) {
  const doubleQuoted = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs || '');
  if (doubleQuoted?.[1] != null) return doubleQuoted[1].trim();
  const singleQuoted = new RegExp(`${name}='([^']*)'`, 'i').exec(attrs || '');
  return singleQuoted?.[1]?.trim() || '';
}

function extractTextByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text || '');
    if (match?.[1]) return stripTags(match[1]);
  }
  return '';
}

function extractEmTexts(text) {
  return Array.from(String(text || '').matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/gi))
    .map(match => stripTags(match[1]))
    .filter(Boolean);
}

function parseShowShopinfoArgs(attrs) {
  const match = /showShopinfo\(([\s\S]*?)\)/i.exec(attrs || '');
  if (!match) return [];
  return Array.from(match[1].matchAll(/'((?:\\'|[^'])*)'/g))
    .map(item => item[1].replace(/\\'/g, "'").trim());
}

function extractSection(html, tagName, className) {
  const pattern = new RegExp(`<${tagName}[^>]*class=(["'])[^"'<>]*\\b${className}\\b[^"'<>]*\\1[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  return pattern.exec(html)?.[2] || '';
}

function parseInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

export function parsePrice(value) {
  const raw = stripTags(String(value ?? '')).replace(/^价格[:：]?\s*/i, '').trim();
  if (!raw) return { raw: '', value: undefined };
  const compact = raw.replace(/,/g, '').replace(/金币|洛克贝|币/g, '').trim();
  const match = compact.match(/([\d.]+)\s*(w|W|万)?/);
  if (!match) return { raw, value: undefined };
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return { raw, value: undefined };
  const multiplier = match[2] ? 10000 : 1;
  return { raw, value: Math.round(numeric * multiplier) };
}

export function parseLimit(value) {
  const raw = stripTags(String(value ?? ''));
  const match = raw.match(/限购\s*(\d+)/i) || raw.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseServerNowMs(html) {
  const seconds = parseInteger(/var\s+serverNow\s*=\s*(\d+)\s*;?/i.exec(html)?.[1]);
  return seconds ? seconds * 1000 : undefined;
}

function parsePrimarySlots(html) {
  const section = extractSection(html, 'ul', 'time-list') || html;
  const slots = [];
  for (const match of section.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const attrs = match[1] || '';
    const block = match[2] || '';
    const className = extractAttr(attrs, 'class');
    const slotIndex = parseInteger(extractAttr(attrs, 'data-index'))
      || parseInteger(/\bcheck_(\d+)\b/i.exec(className)?.[1]);
    const times = extractEmTexts(block).filter(value => /^\d{1,2}:\d{2}$/.test(value));
    if (!slotIndex || times.length < 2) continue;
    slots.push({ index: slotIndex, start: times[0], end: times[1], active: /\bon\b/.test(className) });
  }
  if (slots.length) return uniqueBy(slots, slot => slot.index).sort((a, b) => a.index - b.index);

  const match = /var\s+refreshHour\s*=\s*\[([^\]]+)\]\s*;?/i.exec(html);
  if (!match) return [];
  const values = match[1].split(',').map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v >= 0 && v <= 24);
  const startOffset = values[0] === 0 ? 1 : 0;
  const result = [];
  for (let i = startOffset; i < values.length; i += 1) {
    const start = values[i];
    const end = values[i + 1] ?? 24;
    if (start < end) result.push({ index: i - startOffset + 1, start: `${pad(start)}:00`, end: `${pad(end)}:00`, active: false });
  }
  return result;
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

function parseItemCandidates(html) {
  const section = extractSection(html, 'ul', 'shop-list') || html;
  const candidates = [];
  for (const match of section.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const attrs = match[1] || '';
    const block = match[2] || '';
    const className = extractAttr(attrs, 'class');
    if (className.includes('show_none_tip')) continue;
    const showInfoArgs = parseShowShopinfoArgs(attrs);
    const slotIndexes = uniqueBy(
      Array.from(className.matchAll(/\bshow_(\d+)\b/g)).map(item => Number(item[1])).filter(Number.isInteger),
      value => value,
    );
    const style = extractAttr(attrs, 'style').replace(/\s+/g, '').toLowerCase();
    const visible = !style.includes('display:none');
    const name = extractTextByPatterns(block, [
      /<em[^>]*class=["'][^"']*shop_name[^"']*["'][^>]*>([\s\S]*?)<\/em>/i,
      /<p[^>]*>\s*<em[^>]*>([\s\S]*?)<\/em>\s*<\/p>/i,
    ]) || showInfoArgs[1] || '';
    if (!name) continue;
    const priceText = extractTextByPatterns(block, [
      /<em[^>]*class=["'][^"']*shop_price[^"']*["'][^>]*>([\s\S]*?)<\/em>/i,
      /(价格[:：]\s*[\d.,]+(?:w|W|万)?)/i,
    ]);
    const limitText = extractTextByPatterns(block, [
      /<div[^>]*class=["'][^"']*gitem[^"']*["'][^>]*>[\s\S]*?<em>([\s\S]*?)<\/em>/i,
      /(限购\s*\d+)/i,
    ]);
    const price = parsePrice(priceText);
    candidates.push({ name: name.trim(), priceRaw: price.raw, price: price.value, limit: parseLimit(limitText), slotIndexes, visible });
  }
  return candidates;
}

export function parseOnebijiHtml(html, expectedSlot, observedAtMs = Date.now()) {
  if (!expectedSlot) throw new Error('当前不在远行商人营业时间');
  const serverNowMs = parseServerNowMs(html);
  if (!serverNowMs) throw new Error('好游快爆页面缺少 serverNow，无法验证数据新鲜度');
  const ageMs = Math.abs(observedAtMs - serverNowMs);
  if (ageMs > FRESHNESS_MS) throw new Error(`好游快爆页面 serverNow 与当前时间相差 ${Math.round(ageMs / 60000)} 分钟`);

  const serverDate = resolveExpectedSlot(serverNowMs)?.date || (() => {
    const p = beijingParts(serverNowMs);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  })();
  if (serverDate !== expectedSlot.date) throw new Error(`好游快爆页面日期为 ${serverDate}，当前日期为 ${expectedSlot.date}`);

  const slots = parsePrimarySlots(html);
  const slot = slots.find(item => item.index === expectedSlot.index);
  if (!slot) throw new Error(`好游快爆页面缺少第 ${expectedSlot.index} 轮时间段`);
  const slotLabel = `${slot.start}-${slot.end}`;
  if (slotLabel !== expectedSlot.label) throw new Error(`好游快爆第 ${expectedSlot.index} 轮标记为 ${slotLabel}，预期 ${expectedSlot.label}`);

  const candidates = parseItemCandidates(html);
  let selected = candidates.filter(item => item.slotIndexes.includes(expectedSlot.index));
  if (!selected.length) selected = candidates.filter(item => item.visible);
  const items = validateAndNormalizeItems(selected, '好游快爆');
  if (!items.length) throw new Error(`好游快爆未解析到 ${expectedSlot.label} 商品`);

  return {
    source: 'onebiji',
    sourceUrl: ONEBIJI_URL,
    serverNow: new Date(serverNowMs).toISOString(),
    serverNowBeijing: formatBeijing(serverNowMs),
    slot: expectedSlot,
    items,
  };
}

function validateAndNormalizeItems(items, source) {
  const output = [];
  for (const item of items) {
    const name = String(item.name || '').trim();
    if (!name) throw new Error(`${source}存在空商品名`);
    if (!Number.isFinite(item.price) || item.price < 0) throw new Error(`${source}商品“${name}”价格不可解析：${item.priceRaw || ''}`);
    if (!Number.isInteger(item.limit) || item.limit <= 0) throw new Error(`${source}商品“${name}”限购不可解析`);
    output.push({ name, priceRaw: item.priceRaw || String(item.price), price: item.price, limit: item.limit });
  }
  const duplicateNames = output.map(item => item.name).filter((name, i, all) => all.indexOf(name) !== i);
  if (duplicateNames.length) throw new Error(`${source}出现重复商品：${[...new Set(duplicateNames)].join('、')}`);
  return output;
}

function canonicalItems(items) {
  return [...items]
    .map(item => ({ name: item.name, price: item.price, limit: item.limit }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function itemsSignature(items) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalItems(items))).digest('hex');
}

function assertSameItems(first, second, label) {
  const a = itemsSignature(first);
  const b = itemsSignature(second);
  if (a !== b) {
    throw new Error(`${label}两次独立读取不一致：${JSON.stringify(canonicalItems(first))} != ${JSON.stringify(canonicalItems(second))}`);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnebijiHttp() {
  const url = new URL(ONEBIJI_URL);
  url.searchParams.set('_fresh', `${Date.now()}-${crypto.randomUUID()}`);
  const response = await fetchWithTimeout(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`好游快爆 HTTP ${response.status}`);
  const html = await response.text();
  if (html.length < 1000) throw new Error(`好游快爆响应过短：${html.length}`);
  return { html, transport: 'http', responseDate: response.headers.get('date') };
}

async function fetchOnebijiBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    await context.setExtraHTTPHeaders({ 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' });
    const page = await context.newPage();
    const url = new URL(ONEBIJI_URL);
    url.searchParams.set('_fresh', `${Date.now()}-${crypto.randomUUID()}`);
    const response = await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 45000 });
    if (!response || !response.ok()) throw new Error(`浏览器加载好游快爆失败：${response?.status() ?? '无响应'}`);
    await page.waitForSelector('ul.shop-list li', { timeout: 15000 });
    const html = await page.content();
    return { html, transport: 'chromium', responseDate: response.headers().date || null };
  } finally {
    await browser.close();
  }
}

async function readOnebijiOnce(expectedSlot, forceBrowser = false) {
  const fetched = forceBrowser ? await fetchOnebijiBrowser() : await fetchOnebijiHttp();
  return { ...parseOnebijiHtml(fetched.html, expectedSlot), transport: fetched.transport, responseDate: fetched.responseDate };
}

async function readOnebijiVerified(expectedSlot) {
  const errors = [];
  for (const forceBrowser of [false, true]) {
    try {
      const first = await readOnebijiOnce(expectedSlot, forceBrowser);
      await sleep(2500);
      const second = await readOnebijiOnce(expectedSlot, forceBrowser);
      assertSameItems(first.items, second.items, `好游快爆(${first.transport})`);
      return { first, second, transport: first.transport, signature: itemsSignature(first.items) };
    } catch (error) {
      errors.push(`${forceBrowser ? 'Chromium' : 'HTTP'}：${error.message}`);
    }
  }
  throw new Error(errors.join('；'));
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function firstValue(record, keys) {
  for (const key of keys) if (record[key] != null && record[key] !== '') return record[key];
  return undefined;
}
function firstText(record, keys) {
  const value = firstValue(record, keys);
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function normalizeTimestampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

async function fetchArkmengToken() {
  const response = await fetchWithTimeout(`${ARKMENG_BASE_URL}/api/web-auth/guest`, {
    method: 'POST',
    headers: { Origin: ARKMENG_BASE_URL, Referer: `${ARKMENG_BASE_URL}/merchant`, 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`游客 token HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.token) throw new Error(payload?.message || payload?.error || '游客 token 缺失');
  return payload.token;
}

async function fetchArkmengOnce(expectedSlot) {
  const token = await fetchArkmengToken();
  const response = await fetchWithTimeout(`${ARKMENG_BASE_URL}/api/server-function`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: ARKMENG_BASE_URL,
      Referer: `${ARKMENG_BASE_URL}/merchant`,
      'User-Agent': USER_AGENT,
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({ name: 'merchant', data: { fresh: true, nonce: crypto.randomUUID() } }),
  });
  if (!response.ok) throw new Error(`远行商人接口 HTTP ${response.status}`);
  const payload = await response.json();
  if (!Object.hasOwn(payload, 'result')) throw new Error(payload?.message || payload?.error || '接口缺少 result');
  return normalizeArkmeng(payload.result, expectedSlot);
}

export function normalizeArkmeng(result, expectedSlot) {
  const root = asRecord(result);
  const data = asRecord(root.data);
  const container = Object.keys(data).length ? data : root;
  const activities = asArray(container.merchantActivities);
  const activity = asRecord(activities[0]);
  const rawItems = asArray(activity.get_props).length ? asArray(activity.get_props)
    : asArray(container.items).length ? asArray(container.items)
      : activities;
  if (!rawItems.length) throw new Error(firstText(container, ['message']) || '洛克万事屋未返回商品');

  const activityStart = normalizeTimestampMs(firstValue(activity, ['start_time', 'startTime']));
  const activityEnd = normalizeTimestampMs(firstValue(activity, ['end_time', 'endTime']));
  const itemRows = rawItems.map(raw => {
    const item = asRecord(raw);
    const name = firstText(item, ['name', 'goodsName', 'title', 'nm']);
    if (!name) return null;
    const parsedPrice = parsePrice(firstValue(item, ['price', 'pr', 'shop_price']));
    const limit = parseLimit(firstValue(item, ['limit', 'limited', 'buy_limit']));
    const start = normalizeTimestampMs(firstValue(item, ['start_time', 'startTime'])) || activityStart;
    const end = normalizeTimestampMs(firstValue(item, ['end_time', 'endTime'])) || activityEnd;
    return { name, priceRaw: parsedPrice.raw, price: parsedPrice.value, limit, start, end };
  }).filter(Boolean);

  const currentRows = itemRows.filter(item => {
    if (!item.start || !item.end) return true;
    const now = Date.now();
    return item.start <= now && now < item.end;
  });
  const rows = currentRows.length ? currentRows : itemRows;
  const items = rows.map(item => {
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
  if (!items.length) throw new Error('洛克万事屋未返回可识别的商品名称');

  const starts = rows.map(item => item.start).filter(Boolean);
  const ends = rows.map(item => item.end).filter(Boolean);
  const roundStart = starts.length ? Math.min(...starts) : activityStart;
  const roundEnd = ends.length ? Math.max(...ends) : activityEnd;
  if (roundStart && roundEnd) {
    const startHour = beijingParts(roundStart).hour;
    const endParts = beijingParts(roundEnd);
    const endHour = endParts.hour === 0 && endParts.day !== beijingParts(roundStart).day ? 24 : endParts.hour;
    const label = `${pad(startHour)}:00-${pad(endHour)}:00`;
    if (label !== expectedSlot.label) throw new Error(`洛克万事屋轮次 ${label}，预期 ${expectedSlot.label}`);
  }
  return { source: 'arkmeng', sourceUrl: `${ARKMENG_BASE_URL}/merchant`, slot: expectedSlot, items };
}

async function readArkmengVerified(expectedSlot) {
  const first = await fetchArkmengOnce(expectedSlot);
  await sleep(1500);
  const second = await fetchArkmengOnce(expectedSlot);
  assertSameItems(first.items, second.items, '洛克万事屋');
  return { first, second, signature: itemsSignature(first.items) };
}

export function crossValidate(primaryItems, auxiliaryItems) {
  const primary = new Map(primaryItems.map(item => [item.name, item]));
  const auxiliary = new Map(auxiliaryItems.map(item => [item.name, item]));
  const conflicts = [];
  for (const [name, aux] of auxiliary) {
    const main = primary.get(name);
    if (!main) {
      conflicts.push(`辅助源存在主源没有的商品“${name}”`);
      continue;
    }
    const priceConflict = Number.isFinite(aux.price) && main.price !== aux.price;
    const limitConflict = Number.isInteger(aux.limit) && aux.limit > 0 && main.limit !== aux.limit;
    if (priceConflict || limitConflict) {
      conflicts.push(`“${name}”已提供字段冲突：主源 ${main.price}/${main.limit}，辅助源 ${aux.price ?? '缺失'}/${aux.limit ?? '缺失'}`);
    }
  }
  const primaryWatch = WATCH_ITEMS.filter(name => primary.has(name));
  const auxiliaryWatch = WATCH_ITEMS.filter(name => auxiliary.has(name));
  for (const name of WATCH_ITEMS) {
    if (primary.has(name) !== auxiliary.has(name) && auxiliary.size >= primary.size) {
      conflicts.push(`关注商品“${name}”在两源判断不一致`);
    }
  }
  return {
    ok: conflicts.length === 0,
    conflicts,
    auxiliaryIsSubset: [...auxiliary.keys()].every(name => primary.has(name)),
    primaryWatch,
    auxiliaryWatch,
  };
}

async function ensureStatusDir() {
  await fs.mkdir(STATUS_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function markdownItems(items) {
  return items.map(item => `| ${item.name} | ${item.priceRaw} | ${item.price} | ${item.limit} |`).join('\n');
}

async function githubRequest(endpoint, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('缺少 GITHUB_TOKEN 或 GITHUB_REPOSITORY');
  const response = await fetchWithTimeout(`https://api.github.com/repos/${repository}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'roco-merchant-watcher',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${data?.message || text}`);
  return data;
}

async function issueExists(marker) {
  const issues = await githubRequest('/issues?state=all&per_page=100');
  return issues.some(issue => String(issue.body || '').includes(marker));
}

async function createIssue({ title, body, labels = [], marker }) {
  if (await issueExists(marker)) return { created: false, reason: 'duplicate' };
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
  const issue = await githubRequest('/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body: `${body}\n\n<!-- ${marker} -->`, labels, assignees: owner ? [owner] : [] }),
  });
  return { created: true, number: issue.number, url: issue.html_url };
}

async function sendSmtpMail(subject, text) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_AUTH_CODE;
  const to = process.env.ALERT_EMAILS || process.env.ALERT_EMAIL || '15862845902@163.com';
  if (!user || !pass) return { sent: false, reason: 'SMTP secrets not configured' };
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    auth: { user, pass },
  });
  const info = await transporter.sendMail({ from: user, to, subject, text });
  return { sent: true, messageId: info.messageId, to };
}

async function notifyMatch(status) {
  const marker = `roco-match:${status.slot.key}:${status.signature}`;
  const matched = status.matches;
  const body = [
    `@${process.env.GITHUB_REPOSITORY?.split('/')[0] || 'owner'} 发现远行商人关注商品。`,
    '',
    `- 北京时间：${status.checkedAtBeijing}`,
    `- 当前轮次：${status.slot.label}`,
    `- 数据获取：好游快爆 ${status.primary.transport} 双次一致`,
    `- 完整商品数：${status.items.length}`,
    `- 辅助源：${status.auxiliary.status}`,
    '',
    '| 命中商品 | 原始价格 | 标准价格 | 限购 |',
    '|---|---:|---:|---:|',
    markdownItems(matched),
    '',
    `- 好游快爆：${ONEBIJI_URL}`,
    `- 洛克万事屋：${ARKMENG_BASE_URL}/merchant`,
  ].join('\n');
  const issue = await createIssue({ title: `【远行商人提醒】${matched.map(item => item.name).join('、')}｜${status.slot.label}`, body, labels: [], marker });
  const mail = await sendSmtpMail('洛克王国远行商人提醒：发现关注商品', body);
  return { issue, mail };
}

async function notifyFailure(status) {
  const marker = `roco-failure:${status.slot?.key || 'closed'}`;
  const body = [
    '远行商人本轮未能完成可靠读取，程序没有把失败误判为“目标商品未出现”。',
    '',
    `- 北京时间：${status.checkedAtBeijing}`,
    `- 预期轮次：${status.slot?.label || '非营业时间'}`,
    `- 错误：${status.error}`,
    `- 好游快爆：${ONEBIJI_URL}`,
    `- 洛克万事屋：${ARKMENG_BASE_URL}/merchant`,
  ].join('\n');
  return createIssue({ title: `【远行商人读取失败】${status.slot?.label || status.checkedAtBeijing}`, body, labels: [], marker });
}

export async function run() {
  await ensureStatusDir();
  const now = Date.now();
  const slot = resolveExpectedSlot(now);
  const baseStatus = {
    checkedAt: new Date(now).toISOString(),
    checkedAtBeijing: formatBeijing(now),
    slot,
    watchItems: [...WATCH_ITEMS],
  };

  if (!slot) {
    const status = { ...baseStatus, status: 'closed', message: '当前不在远行商人营业时间' };
    await writeJson(LATEST_PATH, status);
    console.log(JSON.stringify(status, null, 2));
    return status;
  }

  try {
    const primary = await readOnebijiVerified(slot);
    let auxiliary;
    try {
      const verified = await readArkmengVerified(slot);
      const validation = crossValidate(primary.first.items, verified.first.items);
      if (!validation.ok) throw new Error(`AUXILIARY_CONFLICT:${validation.conflicts.join('；')}`);
      auxiliary = { status: 'ok', itemCount: verified.first.items.length, validation, signature: verified.signature };
    } catch (error) {
      if (String(error.message || '').startsWith('AUXILIARY_CONFLICT:')) throw error;
      auxiliary = { status: 'unavailable', error: error.message };
    }

    const items = primary.first.items;
    const matches = items.filter(item => WATCH_ITEMS.includes(item.name));
    const signature = primary.signature;
    const status = {
      ...baseStatus,
      status: 'ok',
      signature,
      primary: {
        source: 'onebiji',
        transport: primary.transport,
        serverNowBeijing: primary.first.serverNowBeijing,
        responseDate: primary.first.responseDate,
        doubleReadConsistent: true,
      },
      auxiliary,
      itemCount: items.length,
      items,
      matches,
      notification: null,
    };

    if (matches.length) status.notification = await notifyMatch(status);
    await writeJson(LATEST_PATH, status);
    await writeJson(path.join(STATUS_DIR, `${slot.key}.json`), status);
    const notified = await readJson(NOTIFIED_PATH, { matches: [] });
    if (matches.length && !notified.matches.includes(`${slot.key}:${signature}`)) {
      notified.matches.push(`${slot.key}:${signature}`);
      notified.matches = notified.matches.slice(-200);
      await writeJson(NOTIFIED_PATH, notified);
    }
    console.log(JSON.stringify(status, null, 2));
    return status;
  } catch (error) {
    const status = { ...baseStatus, status: 'error', error: error?.stack || error?.message || String(error), notification: null };
    try { status.notification = await notifyFailure(status); } catch (notifyError) { status.notification = { error: notifyError.message }; }
    await writeJson(LATEST_PATH, status);
    await writeJson(path.join(STATUS_DIR, `${slot.key}-failure.json`), status);
    console.error(JSON.stringify(status, null, 2));
    process.exitCode = 1;
    return status;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
