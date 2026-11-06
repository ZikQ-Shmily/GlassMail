const {app, BrowserWindow, ipcMain, safeStorage, dialog, Notification, Tray, Menu, nativeImage} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Monitor} = require('./monitor.cjs');
let win, tray, state, file, monitor, domain, quitting = false, timer;
let customSound = null;
const isSmoke = process.argv.includes('--smoke-test');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('com.glassmail.desktop');
if (!isSmoke && !app.requestSingleInstanceLock()) app.quit();
function persist() { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file + '.tmp', JSON.stringify(state), {mode: 0o600}); fs.renameSync(file + '.tmp', file); }
function publicState() { return {accounts: state.accounts.map(({secret, ...a}) => ({...a, hasPassword: !!secret, status: monitor?.status[a.id] || {state: a.enabled ? 'waiting' : 'disabled', message: a.enabled ? '等待同步' : '已停用'}})), rules: state.rules, messages: state.messages, alerts: state.alerts, settings: state.settings, customSound: customSound ? {name: state.customSoundName, data: customSound} : null}; }
function publish() { if (win && !win.isDestroyed()) win.webContents.send('glassmail:state', publicState()); }
function encrypt(value) { if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，无法安全保存授权码'); return safeStorage.encryptString(value).toString('base64'); }
function password(account) { if (!account.secret) return ''; try { return safeStorage.decryptString(Buffer.from(account.secret, 'base64')); } catch { return ''; } }
function onMail(mail, historical) {
  if (state.messages.some(m => m.id === mail.id)) return;
  const rules = historical ? [] : state.rules.filter(r => domain.matchesRule(mail, r));
  mail.matchedRules = rules.map(r => r.name);
  state.messages.unshift(mail); state.messages = state.messages.slice(0, 500);
  if (rules.length && !state.settings.paused) {
    const alert = {id: randomUUID(), messageId: mail.id, subject: mail.subject, sender: mail.senderEmail, accountId: mail.accountId, rules: rules.map(r => r.name), date: new Date().toISOString(), acknowledged: false, sound: rules[0].sound};
    state.alerts.unshift(alert); state.alerts = state.alerts.slice(0, 300);
    win?.webContents.send('glassmail:alert', {...alert, volume: state.settings.volume, loop: state.settings.loopSound, customSound});
    if (state.settings.notifications && Notification.isSupported()) {
      const notification = new Notification({title: `GlassMail · ${rules[0].name}`, body: `${mail.sender}\n${mail.subject}`, silent: true});
      notification.on('click', () => {win.show(); win.focus();}); notification.show();
    }
  }
  persist(); publish();
}
function restartTimer() { clearInterval(timer); timer = setInterval(() => monitor.sync(), state.settings.pollSeconds * 1000); }
function register(name, handler) { ipcMain.handle(`glassmail:${name}`, async (event, ...args) => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('无效的窗口请求');
  try { return await handler(...args); } catch (error) { throw Error(error.message || '操作失败'); }
}); }
function setupIPC() {
  register('state', () => publicState());
  register('saveAccount', input => {
    const account = domain.accountInput(input), old = state.accounts.find(a => a.id === account.id);
    account.id = old?.id || randomUUID();
    const sameIdentity = old && old.email === account.email && old.host === account.host && old.port === account.port;
    account.secret = input.password ? encrypt(String(input.password).slice(0, 4096)) : sameIdentity ? old.secret : '';
    if (!account.secret) throw Error('请填写邮箱授权码或应用专用密码');
    monitor.invalidate(account.id);
    if (!sameIdentity) delete state.cursors[account.id];
    state.accounts = [...state.accounts.filter(a => a.id !== account.id), account]; persist(); publish(); monitor.sync(); return publicState();
  });
  register('deleteAccount', id => {monitor.invalidate(id); state.accounts = state.accounts.filter(a => a.id !== id); state.rules = state.rules.filter(r => r.accountId !== id); state.messages = state.messages.filter(m => m.accountId !== id); state.alerts = state.alerts.filter(m => m.accountId !== id); delete state.cursors[id]; persist(); publish();});
  register('testAccount', async input => {
    const account = domain.accountInput(input), old = state.accounts.find(a => a.id === account.id);
    const same = old && old.email === account.email && old.host === account.host && old.port === account.port;
    const pass = input.password || (same ? password(old) : '');
    if (!pass) throw Error('请先填写授权码'); return monitor.test(account, pass);
  });
  register('saveRule', input => {const rule = domain.ruleInput(input, state.accounts); rule.id = state.rules.some(r => r.id === rule.id) ? rule.id : randomUUID(); state.rules = [...state.rules.filter(r => r.id !== rule.id), rule]; persist(); publish(); return publicState();});
  register('deleteRule', id => {state.rules = state.rules.filter(r => r.id !== id); persist(); publish();});
  register('settings', input => {state.settings = domain.settingsInput({...state.settings, ...input}); persist(); restartTimer(); publish(); return publicState();});
  register('sync', async () => {await monitor.sync(); return publicState();});
  register('markAllRead', () => {state.messages.forEach(mail => {mail.unread = false;}); persist(); publish(); return publicState();});
  register('acknowledge', id => {state.alerts.forEach(a => {if (!id || a.id === id) a.acknowledged = true;}); const mail = state.messages.find(m => m.id === id); if (mail) mail.unread = false; persist(); publish();});
  register('exportConfig', async () => {
    const result = await dialog.showSaveDialog(win, {defaultPath: 'GlassMail-config.json', filters: [{name: 'GlassMail 配置', extensions: ['json']}]});
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(domain.exportConfig(state), null, 2), {mode: 0o600}); return true;
  });
  register('importConfig', async () => {
    const chosen = await dialog.showOpenDialog(win, {properties: ['openFile'], filters: [{name: 'GlassMail 配置', extensions: ['json']}]});
    if (chosen.canceled) return false;
    if (fs.statSync(chosen.filePaths[0]).size > 1024 * 1024) throw Error('配置文件过大');
    const config = domain.importConfig(JSON.parse(fs.readFileSync(chosen.filePaths[0], 'utf8')));
    const answer = await dialog.showMessageBox(win, {type: 'question', buttons: ['取消','导入并替换'], defaultId: 0, cancelId: 0, message: `导入 ${config.accounts.length} 个邮箱、${config.rules.length} 条规则？`, detail: '将替换当前配置。邮箱授权码不在配置文件内，需要在此设备重新填写。相同邮箱已有的本机授权码会保留。'});
    if (answer.response !== 1) return false;
    monitor.stop();
    config.accounts.forEach(a => {const old = state.accounts.find(x => x.id === a.id && x.email === a.email && x.host === a.host && x.port === a.port); a.secret = old?.secret || '';});
    state = {...state, ...config, cursors: {}, messages: [], alerts: []}; persist(); restartTimer(); publish(); monitor.sync(); return true;
  });
  register('chooseSound', async () => {
    const chosen = await dialog.showOpenDialog(win, {properties: ['openFile'], filters: [{name: '音频（最大 5 MB）', extensions: ['mp3','wav','ogg']}]});
    if (chosen.canceled) return false;
    const p = chosen.filePaths[0], ext = path.extname(p).toLowerCase(), types = {'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg'};
    if (!types[ext] || fs.statSync(p).size > 5 * 1024 * 1024) throw Error('请选择 5 MB 以内的 MP3、WAV 或 OGG');
    customSound = `data:${types[ext]};base64,${fs.readFileSync(p).toString('base64')}`;
    fs.writeFileSync(path.join(app.getPath('userData'), 'custom-sound.txt'), customSound, {mode: 0o600});
    state.customSoundName = path.basename(p); persist(); publish(); return true;
  });
  register('clearHistory', () => {state.messages = []; state.alerts = []; persist(); publish();});
  register('windowAction', action => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); });
}
app.whenReady().then(async () => {
  domain = await import('../shared/domain.mjs');
  if (isSmoke) {const testDir = path.join(app.getPath('temp'), `glassmail-smoke-${process.pid}`); fs.mkdirSync(testDir, {recursive:true}); app.setPath('userData', testDir);}
  file = path.join(app.getPath('userData'), 'glassmail.json');
  state = {accounts: [], rules: [], messages: [], alerts: [], cursors: {}, settings: domain.defaults};
  if (fs.existsSync(file)) {
    try { const stored = JSON.parse(fs.readFileSync(file, 'utf8')); const config = domain.importConfig({...stored, format:'glassmail', version:1}); state = {...state, ...stored, ...config, accounts: config.accounts.map(a => ({...a, secret: stored.accounts.find(s => s.id === a.id)?.secret || ''}))}; }
    catch { dialog.showErrorBox('配置读取失败', '原配置文件已保留。请备份后检查 glassmail.json，应用不会覆盖此文件。'); app.quit(); return; }
  }
  try {customSound = fs.readFileSync(path.join(app.getPath('userData'), 'custom-sound.txt'), 'utf8');} catch {}
  win = new BrowserWindow({width: 1440, height: 940, minWidth: 1000, minHeight: 720, title: 'GlassMail', backgroundColor: '#e9f0f3', titleBarStyle: 'hidden', trafficLightPosition: {x: 22,y: 22}, show: false, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  monitor = new Monitor({getState: () => state, password, persist, publish, onMail});
  setupIPC();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'GlassMail', submenu: [{label:'显示 GlassMail', click: () => win.show()}, {role:'quit', label:'退出 GlassMail'}]}, {label:'编辑', submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}, {label:'视图', submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]));
  const icon = nativeImage.createFromPath(path.join(__dirname, '../build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip('GlassMail · 邮件守望');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 GlassMail', click: () => {win.show(); win.focus();}}, {label:'立即同步', click: () => monitor.sync()}, {type:'separator'}, {label:'退出', click: () => app.quit()}])); tray.on('click', () => win.show());
  win.on('close', event => {if (!quitting && state.settings.closeToTray) {event.preventDefault(); win.hide();}});
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.show(); restartTimer(); monitor.sync();
  if (isSmoke) {
    const result = await win.webContents.executeJavaScript(`(async () => {const s = await window.glassmail.state(); for(let i=0;i<100 && !document.querySelector('.app-shell');i++) await new Promise(r=>setTimeout(r,30)); return {title: document.title, bridge: window.glassmail.desktop, accounts: s.accounts.length, rendered: !!document.querySelector('.app-shell'), body: document.body.innerText.slice(0,500)};})()`);
    console.log('GLASSMAIL_SMOKE', JSON.stringify(result)); app.exit(result.rendered && result.bridge ? 0 : 1);
  }
});
app.on('second-instance', () => {if (win) {if (win.isMinimized()) win.restore(); win.show(); win.focus();}});
app.on('before-quit', () => {quitting = true; clearInterval(timer); monitor?.stop();});
app.on('activate', () => win?.show());
app.on('window-all-closed', () => {if (!state?.settings.closeToTray) app.quit();});
