// Execute the real recovery click handler with controlled SDK responses.
// No real account, email or network request is used.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../cloud-sync.js'),'utf8');
const read=source.slice(source.indexOf('  function readable('),source.indexOf('  async function remote('));
const actions=source.slice(source.indexOf('  async function authAction('),source.indexOf("  el('accountForm').addEventListener"));
const reset=source.slice(source.indexOf("  el('accountReset').addEventListener"),source.indexOf("  el('newPasswordForm').addEventListener"));
const nodes={};let calls=0, response={};const messages=[];const buttons=[{disabled:false},{disabled:false}];
function node(id){return nodes[id] ||= {id,hidden:false,value:'',textContent:'',reportValidity:()=>true,appendChild(){},after(n){nodes[n.id]=n;},addEventListener(type,cb){this[type]=cb;},querySelectorAll:()=>buttons};}
const ctx=vm.createContext({el:node,document:{createElement:()=>({appendChild(n){if(n.id)nodes[n.id]=n;}})},navigator:{onLine:true},message:t=>messages.push(t),authBusy:false,client:{auth:{resetPasswordForEmail:async(email,options)=>{calls++;assert.equal(email,'person@example.com');assert.equal(options.redirectTo,'https://example.com/');return response;}}},redirect:()=> 'https://example.com/'});
vm.runInContext(read+actions+reset,ctx);
node('accountEmail').value='person@example.com';node('accountPassword').value='';
async function click(error){response=error?{error}:{};node('accountReset').click();await new Promise(r=>setImmediate(r));return messages.at(-1);}
(async()=>{
assert.match(await click({code:'over_email_send_rate_limit',status:429}),/ограничил отправку/);
assert.match(node('accountErrorCode').textContent,/over_email_send_rate_limit/);
assert.match(await click({code:'unexpected_failure',status:500,message:'Error sending recovery email'}),/настройки отправки писем/);
assert.match(await click({code:'email_address_not_authorized',status:400}),/не разрешил отправку/);
assert.match(await click({code:'email_address_invalid',status:422}),/Проверь адрес/);
assert.match(await click({code:'redirect_to_not_allowed',status:400}),/адрес возврата/);
assert.match(await click({status:503,message:'Service unavailable'}),/Не удалось запросить письмо/);
assert.doesNotMatch(messages.at(-1),/Проверь интернет/);
assert.match(await click({name:'AuthRetryableFetchError',message:'Load failed'}),/Проверь интернет/);
assert.match(await click(),/Если аккаунт существует/);
assert.equal(buttons.every(b=>!b.disabled),true);
const before=calls;ctx.navigator.onLine=false;
assert.match(await click(),/нет интернета/);assert.equal(calls,before);
ctx.navigator.onLine=true;node('accountEmail').reportValidity=()=>false;
await click();assert.equal(calls,before);
console.log('PASS: real recovery handler, empty password accepted, rate limit, mailer failure, sender restriction, invalid address, redirect, server versus network errors, success, offline and invalid email. No emails sent.');
})().catch(e=>{console.error(e);process.exitCode=1;});
