export const defaults = { volume: 65, loopSound: false, notifications: true, paused: false, pollSeconds: 45, theme: 'light', closeToTray: true };
const str = (x, max = 300) => String(x ?? '').trim().slice(0, max);
const id = x => str(x, 100);
export function accountInput(a) {
  const value = { id: id(a.id), name: str(a.name, 80), email: str(a.email), host: str(a.host), port: Number(a.port), enabled: a.enabled !== false };
  if (!value.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw Error('请填写邮箱名称和有效的邮箱地址');
  if (!/^[a-zA-Z0-9.-]+$/.test(value.host) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw Error('请填写有效的 IMAP 服务器和端口');
  return value;
}
export function ruleInput(r, accounts) {
  const value = { id: id(r.id), name: str(r.name, 80), accountId: id(r.accountId), sender: str(r.sender), senderMode: r.senderMode === 'domain' ? 'domain' : 'exact', keywords: str(r.keywords, 1000), field: ['subject','body','both'].includes(r.field) ? r.field : 'both', mode: r.mode === 'any' ? 'any' : 'all', sound: ['glass','chime','pulse','beacon','custom'].includes(r.sound) ? r.sound : 'glass', enabled: r.enabled !== false };
  if (!value.name) throw Error('请填写规则名称');
  if (value.accountId && !accounts.some(a => a.id === value.accountId)) throw Error('规则关联的邮箱不存在');
  if (!value.sender && !value.keywords.split(/[,，\n]/).some(k => k.trim())) throw Error('请至少设置发件人或内容关键词');
  if (value.sender && (value.senderMode === 'exact' ? !/^[^\s@]+@[^\s@]+$/.test(value.sender) : !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.sender.replace(/^@/, '')))) throw Error('请填写正确的发件人地址或域名');
  return value;
}
export function matchesRule(mail, rule) {
  if (!rule.enabled || (rule.accountId && rule.accountId !== mail.accountId)) return false;
  const checks = [], sender = (mail.senderEmail || '').toLowerCase();
  if (rule.sender) checks.push(rule.senderMode === 'domain' ? sender.split('@')[1] === rule.sender.toLowerCase().replace(/^@/, '') : sender === rule.sender.toLowerCase());
  const keywords = (rule.keywords || '').split(/[,，\n]/).map(v => v.trim().toLowerCase()).filter(Boolean);
  if (keywords.length) {
    const haystack = (rule.field === 'subject' ? mail.subject : rule.field === 'body' ? mail.body : `${mail.subject}\n${mail.body}`).toLowerCase();
    checks.push(rule.mode === 'all' ? keywords.every(k => haystack.includes(k)) : keywords.some(k => haystack.includes(k)));
  }
  return checks.length > 0 && (rule.mode === 'all' ? checks.every(Boolean) : checks.some(Boolean));
}
export function settingsInput(s) { return { volume: Math.max(0, Math.min(100, Number(s.volume) || 0)), loopSound: s.loopSound === true, notifications: s.notifications !== false, paused: !!s.paused, pollSeconds: Math.max(30, Math.min(600, Number(s.pollSeconds) || 45)), theme: s.theme === 'dark' ? 'dark' : 'light', closeToTray: s.closeToTray !== false }; }
export function exportConfig(state) { return { format: 'glassmail', version: 1, exportedAt: new Date().toISOString(), accounts: state.accounts.map(({secret, ...a}) => a), rules: state.rules.map(r => ({...r, sound: r.sound === 'custom' ? 'glass' : r.sound})), settings: state.settings }; }
export function importConfig(data) {
  if (data?.format !== 'glassmail' || data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.rules) || data.accounts.length > 50 || data.rules.length > 200) throw Error('不是有效的 GlassMail 配置文件');
  const accounts = data.accounts.map(accountInput);
  if (accounts.some(a => !a.id) || new Set(accounts.map(a => a.id)).size !== accounts.length) throw Error('邮箱编号无效或重复');
  const rules = data.rules.map(r => ruleInput(r, accounts));
  if (rules.some(r => !r.id) || new Set(rules.map(r => r.id)).size !== rules.length) throw Error('规则编号无效或重复');
  return {accounts, rules, settings: settingsInput({...defaults, ...data.settings})};
}
export function planFetch(cursor, validity, uidNext, recentUids = []) {
  const same = cursor && String(cursor.validity) === String(validity);
  return same ? { initial: false, start: cursor.uid + 1 } : { initial: true, uids: recentUids.slice(-30), baseline: Math.max(0, uidNext - 1) };
}
