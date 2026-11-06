import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesRule,ruleInput,accountInput,exportConfig,importConfig,defaults,settingsInput} from '../shared/domain.mjs';
const account={id:'a',name:'工作',email:'me@example.com',host:'imap.example.com',port:993,enabled:true,secret:'encrypted-local-value'};
const rule={id:'r',name:'告警',enabled:true,accountId:'a',sender:'alerts@example.com',senderMode:'exact',keywords:'CPU,异常',field:'both',mode:'all',sound:'glass'};
const mail={accountId:'a',senderEmail:'ALERTS@example.com',subject:'CPU 告警',body:'服务异常'};
test('AND 同时要求准确发件人与全部关键词；限制收件邮箱',()=>{
 assert.equal(matchesRule(mail,rule),true);
 assert.equal(matchesRule({...mail,accountId:'b'},rule),false);
 assert.equal(matchesRule({...mail,body:'运行正常'},rule),false);
 assert.equal(matchesRule({...mail,senderEmail:'fake-alerts@example.com'},rule),false);
});
test('域名匹配不接受后缀伪装域名；禁用规则不匹配',()=>{
 const r={...rule,sender:'example.com',senderMode:'domain',keywords:''};
 assert.equal(matchesRule(mail,r),true);
 assert.equal(matchesRule({...mail,senderEmail:'alerts@badexample.com'},r),false);
 assert.equal(matchesRule({...mail,senderEmail:'alerts@example.com.attacker.org'},r),false);
 assert.equal(matchesRule(mail,{...r,enabled:false}),false);
});
test('OR、中文逗号和主题/正文范围',()=>{
 const r={...rule,mode:'any',keywords:'故障，异常',field:'body'};
 assert.equal(matchesRule({...mail,senderEmail:'other@example.com'},r),true);
 assert.equal(matchesRule({...mail,senderEmail:'other@example.com',body:'正常',subject:'异常'},r),false);
 assert.equal(matchesRule({...mail,body:'正常'},r),true);
 assert.equal(matchesRule(mail,{...r,sender:'',keywords:''}),false);
});
test('配置迁移不导出授权码，导入仅保留白名单字段',()=>{
 const exported=exportConfig({accounts:[account],rules:[{...rule,sound:'custom'}],settings:defaults});
 assert.equal(JSON.stringify(exported).includes('encrypted-local-value'),false);
 assert.equal(exported.rules[0].sound,'glass');
 const imported=importConfig({...exported,accounts:[{...account,password:'malicious',secret:'inject'}]});
 assert.equal(imported.accounts[0].secret,undefined);
 assert.equal(imported.accounts[0].password,undefined);
 assert.equal(imported.accounts[0].email,account.email);
});
test('损坏、重复或孤立的导入配置被拒绝，端口及发件人输入受校验',()=>{
 const config=exportConfig({accounts:[account],rules:[rule],settings:defaults});
 assert.throws(()=>importConfig({...config,version:2}));
 assert.throws(()=>importConfig({...config,accounts:[account,account]}));
 assert.throws(()=>importConfig({...config,accounts:[]}));
 assert.throws(()=>ruleInput({...rule,sender:'wrong'},[account]));
 assert.throws(()=>accountInput({...account,port:99999}));
});

test('循环播放设置兼容旧配置，严格校验并随配置迁移保留',()=>{
 assert.equal(defaults.loopSound,false);
 const config=exportConfig({accounts:[account],rules:[rule],settings:{...defaults,loopSound:true}});
 assert.equal(importConfig(JSON.parse(JSON.stringify(config))).settings.loopSound,true);
 delete config.settings.loopSound;
 assert.equal(importConfig(config).settings.loopSound,false);
 for (const value of [undefined,false,'false','true',1,null]) assert.equal(settingsInput({...defaults,loopSound:value}).loopSound,false);
 assert.equal(settingsInput({...defaults,loopSound:true}).loopSound,true);
});
