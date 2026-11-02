"""Focused browser integration with a deterministic SDK adapter and fake network.
Run: python tests/cloud-ui.test.py (requires playwright and Chromium).
Actual SQL authorization is covered separately in schema.test.mjs.
"""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
SDK=r'''
window.supabase={createClient:()=>{
 const handlers=[];
 const session=()=>JSON.parse(localStorage.getItem('test-session')||'null');
 const emit=(event,s)=>handlers.forEach(h=>h(event,s));
 const auth={
  getSession:async()=>({data:{session:session()}}),
  onAuthStateChange:cb=>{handlers.push(cb);return {data:{subscription:{unsubscribe(){}}}}},
  signInWithPassword:async({email})=>{const s={user:{id:email.startsWith('b')?'B':'A',email}};localStorage.setItem('test-session',JSON.stringify(s));emit('SIGNED_IN',s);return {data:{session:s}}},
  signUp:async()=>({data:{session:null}}),
  resetPasswordForEmail:async()=>({}),
  updateUser:async()=>({}),
  signOut:async()=>{localStorage.removeItem('test-session');emit('SIGNED_OUT',null);return {}},
 };
 window.__recover=()=>emit('PASSWORD_RECOVERY',session());
 async function request(method,data){return (await fetch('/__cloud',{method:'POST',body:JSON.stringify({method,data,id:session()?.user.id})})).json()}
 return {auth,from:()=>({select:()=>({eq:()=>({maybeSingle:()=>request('read',{})})})}),rpc:(name,data)=>request(name,data)};
}};
'''
product={'cat':"Тени '\"><img src=x onerror=alert(1)>", 'brand':'<img src=x onerror=alert(1)>', 'name':'Моя палетка','color':'Розовый','buyDateStr':'01.01.2024','price':1000,'finished':False,'endDateStr':None}
groups={'tableBody':[product],'skFaceTableBody':[],'skBodyTableBody':[]}
cloud={}; offline={'on':False}; errors=[]

def route(r):
 url=r.request.url
 if '/__cloud' in url:
  if offline['on']:r.abort();return
  req=json.loads(r.request.post_data);uid=req.get('id');method=req['method'];payload=req.get('data',{})
  if method=='read':out={'data':cloud.get(uid)}
  elif method=='pan_delete_account':cloud.pop(uid,None);out={'data':None}
  elif method=='pan_save_collection':
   old=cloud.get(uid);rev=old['revision'] if old else 0
   if payload['p_revision']!=rev:out={'error':{'code':'40001'}}
   else:
    cloud[uid]={'groups':payload['p_groups'],'revision':rev+1};out={'data':[cloud[uid]]}
  else:raise AssertionError(method)
  r.fulfill(content_type='application/json',body=json.dumps(out));return
 if 'supabase-js' in url:r.fulfill(content_type='text/javascript',body=SDK);return
 if 'chart.umd' in url:r.fulfill(content_type='text/javascript',body='window.Chart=class {constructor(e,c){this.data=c.data;this.options=c.options} destroy(){} update(){}};');return
 path=url.split('pan.test/')[-1].split('?')[0]
 file=ROOT/(path or 'index.html')
 if file.is_file():r.fulfill(content_type='text/css' if path.endswith('.css') else 'text/javascript' if path.endswith('.js') else 'text/html',body=file.read_text());return
 r.fulfill(body='')

def setup(browser,user=None):
 context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 if user:context.add_init_script("localStorage.setItem('test-session',JSON.stringify({user:{id:"+json.dumps(user)+",email:"+json.dumps(user.lower()+'@test.test')+"}}))")
 context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto('https://pan.test/');page.wait_for_function('window.PanCloud !== undefined');return context,page

def open_account(p):
 if not p.locator('#accountDialog').is_visible():p.locator('#accountOpen').click()

def login(p,email):
 open_account(p);p.locator('#accountEmail').fill(email);p.locator('#accountPassword').fill('password123');p.locator('#accountSignIn').click();p.wait_for_function('document.getElementById("accountSignedIn").hidden===false')

def close_account(p):
 if p.locator('#accountDialog').is_visible():p.locator('#accountClose').click()

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 c1,p1=setup(browser);p1.wait_for_timeout(150)
 assert p1.evaluate('appCos.length')==0 # no author's seed data in new accounts
 assert p1.locator('#collectionWelcome').is_visible()
 assert not p1.locator('#analyticsContent').is_visible()
 assert p1.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
 assert p1.locator('#collectionWelcome [data-add-product]').bounding_box()['y']+p1.locator('#collectionWelcome [data-add-product]').bounding_box()['height'] <= 844
 p1.screenshot(path='/workspace/project-pan/tests/welcome-mobile.png',full_page=True)
 open_account(p1)
 assert p1.locator('#accountDialog #accountImport').count()==0
 assert p1.locator('#accountDialog #accountExport').count()==0
 assert 'JSON' not in p1.locator('#accountDialog').inner_text()
 close_account(p1)
 p1.locator('#collectionWelcome [data-add-product]').click()
 p1.locator('#productName').fill('Новый крем')
 p1.locator('#productCategory').fill('Крем')
 p1.locator('#productSection').select_option('skFaceTableBody')
 p1.locator('#productForm button[type=submit]').click()
 assert p1.evaluate('appFace.length')==1
 assert p1.locator('#page-skincare-face').is_visible()
 p1.evaluate("showPage('analytics')")
 assert not p1.locator('#collectionWelcome').is_visible()
 assert p1.locator('#analyticsContent').is_visible()
 assert p1.locator('#metrics-row .metric-value').first.inner_text()=='1'
 p1.reload();p1.wait_for_function('appFace.length===1')
 p1.locator('.account-bar [data-open-settings]').click()
 p1.on('dialog',lambda d:d.accept())
 p1.locator('#tableTools summary').click()
 p1.locator('#tableSection').select_option('skBodyTableBody')
 p1.locator('#tableImport').set_input_files(ROOT/'templates'/'skincare.csv')
 p1.wait_for_function('appBody.length===1')
 assert p1.evaluate('appFace.length')==1
 assert 'Уход за телом' in p1.locator('#dataMessage').inner_text()
 p1.locator('#dataDialog details').nth(1).locator('summary').click()
 p1.locator('#accountImport').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps({'version':1,'groups':groups}).encode()})
 p1.wait_for_function('appCos.length===1');p1.locator('#dataClose').click();p1.evaluate("showPage('catalog')")
 assert p1.locator('.prod-brand img').count()==0
 p1.locator('[data-category-handler]').filter(has_text="Тени").click()
 assert p1.locator('.prod-item').count()==1
 login(p1,'a@test.test');p1.wait_for_function('appCos.length===0')
 assert p1.locator('#accountMigrate').is_visible()
 p1.locator('#accountMigrate').click();p1.wait_for_function('document.getElementById("syncStatus").textContent.includes("Синхронизировано")')
 assert cloud['A']['groups']['tableBody'][0]['name']=='Моя палетка'
 c2,p2=setup(browser,'A');p2.wait_for_function('appCos.length===1');p2.evaluate("showPage('catalog')")
 # Archive -> cloud -> second device, date and reason retained.
 close_account(p1);p1.evaluate("showPage('catalog')");p1.locator('[data-archive-group="tableBody"]').first.click()
 p1.locator('#archiveDate').fill('2024-06-20');p1.locator('#archiveReason').select_option('spoiled');p1.locator('.archive-save').click()
 p1.wait_for_function('document.getElementById("syncStatus").textContent.includes("Синхронизировано")')
 p2.evaluate('PanCloud.sync()');p2.wait_for_function('appCos[0].finished')
 assert p2.evaluate('appCos[0].endDateStr')=='20.06.2024'
 # Two divergent offline edits must surface conflict, never overwrite automatically.
 offline['on']=True
 p1.evaluate("persistCollections({tableBody:appCos.map(p=>({...p,name:'Устройство 1'})),skFaceTableBody:[],skBodyTableBody:[]})")
 p2.evaluate("persistCollections({tableBody:appCos.map(p=>({...p,name:'Устройство 2'})),skFaceTableBody:[],skBodyTableBody:[]})")
 p1.wait_for_timeout(100);p2.wait_for_timeout(100);offline['on']=False
 p1.evaluate('PanCloud.sync()');p1.wait_for_function('document.getElementById("syncStatus").textContent.includes("Синхронизировано")')
 p2.evaluate('PanCloud.sync()');p2.wait_for_function('document.getElementById("syncConflict").hidden===false')
 assert cloud['A']['groups']['tableBody'][0]['name']=='Устройство 1'
 open_account(p2);p2.on('dialog',lambda d:d.accept());p2.locator('#syncUseCloud').click();p2.wait_for_function("appCos[0].name==='Устройство 1'")
 # Guest namespace preserved on logout; B cannot inherit A's collection.
 open_account(p1);p1.locator('#accountSignOut').click();p1.wait_for_function('document.getElementById("accountSignedIn").hidden')
 assert p1.evaluate('appCos[0].name')=='Моя палетка'
 login(p1,'b@test.test');p1.wait_for_function('appCos.length===0');assert 'B' not in cloud
 # Lost response retry: identical server payload clears dirty state without duplicating data.
 c3,p3=setup(browser,'A');p3.wait_for_function('appCos.length===1')
 p3.evaluate("const k='project-pan.user.v2.A';const s=JSON.parse(localStorage.getItem(k));s.dirty=true;s.revision=0;localStorage.setItem(k,JSON.stringify(s))")
 p3.reload();p3.wait_for_function('document.getElementById("syncStatus").textContent.includes("Синхронизировано")')
 assert not p3.evaluate("JSON.parse(localStorage.getItem('project-pan.user.v2.A')).dirty")
 # Recovery screen follows SDK PASSWORD_RECOVERY event.
 p3.evaluate('__recover()');p3.wait_for_function('document.getElementById("newPasswordForm").hidden===false')
 assert not errors,errors
 print('PASS: welcome instead of empty charts, manual care product and persistence, aggregate totals, clean login, settings-only backups; empty new users, guest JSON import, safe names/category filters, explicit migration, two-device archive sync, offline conflict, namespace isolation, lost-response recovery, password recovery; no JS runtime errors. SDK/network mocked; SQL tested separately.')
 browser.close()
