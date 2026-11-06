const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
function clientFor(account, password) {
  return new ImapFlow({host: account.host, port: account.port, secure: true, auth: {user: account.email, pass: password}, logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, disableAutoIdle: true});
}
function publicError(error) {
  if (error.authenticationFailed || /auth|credential|login/i.test(error.code || '')) return '认证失败，请检查 IMAP 授权码和邮箱服务设置';
  return '连接失败，请检查 IMAP 地址、TLS 端口、网络和授权码';
}
class Monitor {
  constructor({getState, password, persist, publish, onMail, createClient = clientFor, parse = simpleParser}) { Object.assign(this, {getState, password, persist, publish, onMail, createClient, parse}); this.running = new Set(); this.clients = new Map(); this.status = {}; this.revisions = new Map(); }
  async test(account, password) {
    const client = this.createClient(account, password); client.on('error', () => {});
    try { await client.connect(); await client.mailboxOpen('INBOX', {readOnly: true}); return {ok: true, message: '连接成功，可以接收邮件'}; }
    catch (error) { throw Error(publicError(error)); }
    finally { client.close(); }
  }
  invalidate(id) { this.revisions.set(id, (this.revisions.get(id) || 0) + 1); this.clients.get(id)?.close(); delete this.status[id]; }
  async sync() { await Promise.allSettled(this.getState().accounts.filter(a => a.enabled).map(a => this.poll(a))); }
  async poll(account) {
    if (this.running.has(account.id)) return;
    this.running.add(account.id);
    const revision = this.revisions.get(account.id) || 0;
    const current = () => (this.revisions.get(account.id) || 0) === revision && this.getState().accounts.some(a => a.id === account.id && a.enabled);
    let client;
    try {
      this.status[account.id] = {state: 'syncing', message: '正在同步'}; this.publish();
      const password = this.password(account);
      if (!password) throw Error('MISSING_PASSWORD');
      client = this.createClient(account, password); this.clients.set(account.id, client); client.on('error', () => {});
      await client.connect();
      const lock = await client.getMailboxLock('INBOX', {readOnly: true});
      try {
        const state = this.getState(), validity = String(client.mailbox.uidValidity), cursor = state.cursors[account.id];
        const {planFetch} = await import('../shared/domain.mjs');
        const {initial} = planFetch(cursor, validity, client.mailbox.uidNext);
        const baseline = Math.max(0, client.mailbox.uidNext - 1);
        let uids;
        if (initial) { uids = await client.search({all: true}, {uid: true}); uids = (uids || []).filter(uid => uid <= baseline).slice(-30); }
        else if (baseline > cursor.uid) { uids = await client.search({uid: `${cursor.uid + 1}:${baseline}`}, {uid: true}); uids = (uids || []).filter(uid => uid > cursor.uid).slice(0, 100); }
        else uids = [];
        let last = cursor?.uid || 0;
        for (const uid of uids) {
          if (!current()) return;
          const msg = await client.fetchOne(uid, {envelope: true, internalDate: true, bodyStructure: true, size: true}, {uid: true});
          if (!msg) { last = uid; continue; }
          let body = '';
          if (msg.size <= 5 * 1024 * 1024) {
            const full = await client.fetchOne(uid, {source: true}, {uid: true});
            if (full?.source) { const parsed = await this.parse(full.source, {skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true}); body = (parsed.text || '').slice(0, 100000); }
          }
          if (!current()) return;
          const sender = msg.envelope?.from?.[0] || {};
          this.onMail({id: `${account.id}:${validity}:${uid}`, accountId: account.id, sender: sender.name || sender.address || '未知发件人', senderEmail: sender.address || '', subject: msg.envelope?.subject || '（无主题）', body, bodySkipped: msg.size > 5 * 1024 * 1024, date: (msg.internalDate || new Date()).toISOString(), receivedAt: new Date().toISOString(), unread: true}, initial);
          last = uid;
          state.cursors[account.id] = {validity, uid: initial ? baseline : last};
          this.persist();
        }
        if (current()) {
          state.cursors[account.id] = {validity, uid: initial ? baseline : uids.length ? last : Math.max(cursor?.uid || 0, baseline)};
          this.persist();
          this.status[account.id] = {state: 'connected', message: '连接正常', lastSync: new Date().toISOString()};
        }
      } finally { lock.release(); }
    } catch (error) {
      if (current()) this.status[account.id] = {state: 'error', message: error.message === 'MISSING_PASSWORD' ? '请填写本机邮箱授权码' : publicError(error)};
    } finally { client?.close(); this.clients.delete(account.id); this.running.delete(account.id); this.publish(); }
  }
  stop() { for (const id of this.running) this.invalidate(id); }
}
module.exports = { Monitor };
