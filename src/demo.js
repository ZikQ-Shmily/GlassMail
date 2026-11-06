import {defaults} from '../shared/domain.mjs';
const ago = minutes => new Date(Date.now()-minutes*60000).toISOString();
export function demoState() {
  const accounts = [{id:'work',name:'工作邮箱',email:'alex@studio.example',host:'imap.example.com',port:993,enabled:true,hasPassword:false,status:{state:'demo',message:'演示邮箱'}},{id:'personal',name:'个人邮箱',email:'alex@personal.example',host:'imap.example.com',port:993,enabled:true,hasPassword:false,status:{state:'demo',message:'演示邮箱'}}];
  const rules = [{id:'r1',name:'服务器告警',accountId:'work',sender:'monitor.example',senderMode:'domain',keywords:'告警,异常',field:'both',mode:'any',sound:'beacon',enabled:true},{id:'r2',name:'重要客户来信',accountId:'work',sender:'emily@client.example',senderMode:'exact',keywords:'',field:'both',mode:'all',sound:'glass',enabled:true},{id:'r3',name:'账单与付款',accountId:'',sender:'',senderMode:'exact',keywords:'账单,付款',field:'subject',mode:'any',sound:'chime',enabled:true}];
  const messages = [
    {id:'m1',accountId:'work',sender:'Cloud Monitor',senderEmail:'alert@monitor.example',subject:'生产环境 CPU 使用率异常',body:'你好，Alex：\n\n监测到 production-api-01 的 CPU 使用率连续 5 分钟超过 90%。\n\n当前使用率：94.6%\n告警级别：需要关注\n建议检查近期部署及应用日志。\n\nCloud Monitor\n这是一封演示邮件，没有连接真实服务器。',date:ago(2),unread:true,matchedRules:['服务器告警']},
    {id:'m2',accountId:'work',sender:'Emily Chen',senderEmail:'emily@client.example',subject:'关于新一季品牌合作的想法',body:'Alex，你好！\n\n上次的方案很棒，我们希望继续推进下一季度的合作。附件的方向已经内部确认，期待听听你的想法。\n\n方便的话，我们这周找时间聊聊？\n\nEmily\n\n此内容仅用于界面演示。',date:ago(18),unread:true,matchedRules:['重要客户来信']},
    {id:'m3',accountId:'personal',sender:'Linear',senderEmail:'updates@linear.example',subject:'Your weekly workspace digest',body:'本周工作空间摘要\n\n12 个任务已完成，3 个项目正在进行。\n\n此内容仅用于界面演示。',date:ago(42),unread:true,matchedRules:[]},
    {id:'m4',accountId:'work',sender:'Notion',senderEmail:'team@notion.example',subject:'让好想法，有一个新的开始',body:'和团队一起记录每一个好想法。\n\n此内容仅用于界面演示。',date:ago(85),unread:false,matchedRules:[]},
    {id:'m5',accountId:'personal',sender:'Billing',senderEmail:'billing@service.example',subject:'你的十月订阅账单已就绪',body:'本期订阅账单已生成，感谢你的支持。\n\n此内容仅用于界面演示。',date:ago(126),unread:false,matchedRules:['账单与付款']},
    {id:'m6',accountId:'work',sender:'Design Weekly',senderEmail:'hello@design.example',subject:'本周灵感：流动的光与透明的界面',body:'设计是一场持续的观察。\n\n此内容仅用于界面演示。',date:ago(185),unread:false,matchedRules:[]}
  ];
  return {accounts,rules,messages,alerts:[{id:'a1',messageId:'m1',subject:messages[0].subject,sender:messages[0].senderEmail,accountId:'work',rules:['服务器告警'],date:ago(2),acknowledged:false,sound:'beacon'},{id:'a2',messageId:'m2',subject:messages[1].subject,sender:messages[1].senderEmail,accountId:'work',rules:['重要客户来信'],date:ago(18),acknowledged:true,sound:'glass'}],settings:{...defaults},customSound:null};
}
