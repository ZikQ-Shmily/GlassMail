import {defaults, accountInput, ruleInput, settingsInput, importConfig, exportConfig} from '../shared/domain.mjs';
const empty = () => ({accounts:[],rules:[],messages:[],alerts:[],settings:{...defaults},customSound:null});
let cached;
try { cached = JSON.parse(localStorage.getItem('glassmail-preview')) || empty(); } catch {cached = empty();}
const listeners = new Set();
const save = () => {localStorage.setItem('glassmail-preview',JSON.stringify(cached)); listeners.forEach(f => f(structuredClone(cached))); return structuredClone(cached);};
export const api = window.glassmail || {
  desktop:false, state:async () => structuredClone(cached), onState: f => {listeners.add(f); return () => listeners.delete(f);}, onAlert: () => () => {},
  saveAccount:async () => {throw Error('请在桌面版添加真实邮箱；浏览器预览不接收或保存授权码');},
  testAccount:async () => {throw Error('真实 IMAP 连接测试需要在桌面版运行');},
  deleteAccount:async id => {cached.accounts = cached.accounts.filter(a => a.id !== id); save();},
  saveRule:async input => {const rule=ruleInput(input,cached.accounts); rule.id ||= crypto.randomUUID(); cached.rules=[...cached.rules.filter(r=>r.id!==rule.id),rule]; return save();},
  deleteRule:async id => {cached.rules=cached.rules.filter(r=>r.id!==id); save();},
  settings:async input => {cached.settings=settingsInput({...cached.settings,...input}); return save();},
  sync:async () => structuredClone(cached), acknowledge:async () => {}, clearHistory:async () => {cached.messages=[];cached.alerts=[];save();},
  markAllRead:async () => {cached.messages.forEach(mail => {mail.unread = false;}); return save();},
  chooseSound:async () => {throw Error('自定义音频导入需要桌面版');},
  exportConfig:async () => {const blob=new Blob([JSON.stringify(exportConfig(cached),null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download='GlassMail-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;},
  importConfig:async () => {throw Error('请在桌面版中导入配置');}, windowAction:async () => {}
};
