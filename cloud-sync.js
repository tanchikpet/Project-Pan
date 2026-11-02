/* Public client configuration. Database access is enforced by schema.sql, not this key. */
(() => {
  'use strict';
  const URL = 'https://kguiywzypldlxrrayyrg.supabase.co';
  const KEY = 'sb_publishable_v5KlLUWDlFJGBH_qqwbPpw_vh2b52pB';
  const LEGACY = 'project-pan.collection.v1';
  const GUEST = 'project-pan.guest.v2';
  const GROUPS = ['tableBody', 'skFaceTableBody', 'skBodyTableBody'];
  const el = id => document.getElementById(id);
  const empty = () => Object.fromEntries(GROUPS.map(k => [k, []]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const total = groups => GROUPS.reduce((n, key) => n + groups[key].length, 0);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let client, user = null, initialized = false, epoch = 0, busy = false, authBusy = false;
  let state = {groups:empty(), revision:0, dirty:false};
  let lastStored = null, conflict = null, recovery = false;
  const dialog = el('accountDialog');
  const cacheKey = () => user ? 'project-pan.user.v2.' + user.id : GUEST;
  const redirect = () => location.origin + location.pathname;
  const message = text => { el('accountMessage').textContent = text; };
  function normalize(groups) {
    if (!groups || GROUPS.some(k => !Array.isArray(groups[k]) || groups[k].length > 10000)) throw new Error('Некорректная коллекция');
    return Object.fromEntries(GROUPS.map(key => [key, groups[key].map(raw => {
      if (!raw || typeof raw.name !== 'string' || typeof raw.cat !== 'string' || typeof raw.finished !== 'boolean' || !Number.isFinite(raw.price) || raw.price < 0) throw new Error('Некорректное средство');
      const p = {...raw};
      delete p.buyDate; delete p.endDate;
      for (const field of ['name','cat','brand','color','section','buyDateStr','endDateStr','archiveReason','archiveReasonText']) {
        if (p[field] != null && (typeof p[field] !== 'string' || p[field].length > 2000)) throw new Error('Некорректное поле средства');
      }
      p.brand = p.brand || '';
      for (const field of ['buyDateStr','endDateStr']) {
        if (field === 'endDateStr' && !p[field]) continue;
        const value=p[field], date=parseDate(value);
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value || '') || !date || !Number.isFinite(date.getTime()) || localDateISO(date) !== displayToISO(value)) throw new Error('Некорректная дата средства');
      }
      return p;
    })]));
  }
  function load(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.dirty !== 'boolean') throw new Error('Некорректная копия');
    return {...value, groups:normalize(value.groups)};
  }
  function cache(next) {
    const value = JSON.stringify(next);
    localStorage.setItem(cacheKey(), value);
    lastStored = value;
    state = next;
  }
  function apply(groups) {
    const revive = list => list.map(p => ({...p, buyDate:parseDate(p.buyDateStr), endDate:parseDate(p.endDateStr)}));
    [appCos, appFace, appBody] = GROUPS.map(k => revive(groups[k]));
    reinitCurrentPage();
  }
  function status(text) { el('syncStatus').textContent = text; }
  function render() {
    el('accountIdentity').textContent = user ? user.email || 'Мой аккаунт' : 'Без аккаунта';
    el('accountOpen').textContent = user ? 'Мой аккаунт' : 'Войти / Зарегистрироваться';
    el('accountForm').hidden = !!user || recovery;
    el('accountSignedIn').hidden = !user || recovery;
    el('newPasswordForm').hidden = !recovery;
    el('accountSignedEmail').textContent = user?.email || '';
    el('syncConflict').hidden = !conflict;
    let guest = null;
    try { guest = load(GUEST); } catch (_) { /* Export remains available for current state. */ }
    el('accountMigrate').hidden = !user || !guest || !total(guest.groups);
    el('archiveStorageNote').textContent = user
      ? 'Сохраняется на устройстве и отправляется в твой аккаунт при подключении к интернету.'
      : 'Изменения сохраняются в этом браузере на устройстве. Войди для синхронизации.';
  }
  function storageChanged() {
    return localStorage.getItem(cacheKey()) !== lastStored;
  }
  function write(groups) {
    if (!initialized) { toasts('Подожди, проверяем аккаунт'); return false; }
    try {
      if (storageChanged()) {
        message('Коллекция изменена в другой вкладке. Обнови страницу перед редактированием.');
        toasts('Обнови страницу: данные изменились в другой вкладке');
        return false;
      }
      cache({...state, groups:normalize(groups), dirty:!!user});
      status(user ? 'Сохранено на устройстве · ожидает отправки' : 'Сохранено на этом устройстве');
      if (user) setTimeout(sync, 0);
      return true;
    } catch (_) { toasts('Не удалось сохранить данные на устройстве'); return false; }
  }
  function readable(error) {
    if (['PGRST202','PGRST205','42P01','42883'].includes(error?.code)) return 'База ещё не настроена. Нужно выполнить supabase/schema.sql в SQL Editor.';
    if (error?.status === 429) return 'Слишком много попыток. Подожди немного и повтори.';
    if (/email.*not.*confirmed/i.test(error?.message || '')) return 'Подтверди почту по ссылке из письма.';
    if (/invalid.*credentials/i.test(error?.message || '')) return 'Не удалось войти. Проверь почту и пароль.';
    return 'Не удалось связаться с облаком. Проверь интернет и повтори. Локальные данные сохранены.';
  }
  async function remote(id) {
    const result = await client.from('pan_collections').select('groups,revision').eq('user_id', id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return {groups:empty(), revision:0};
    if (!Number.isSafeInteger(result.data.revision) || result.data.revision < 1) throw new Error('Invalid revision');
    return {groups:normalize(result.data.groups), revision:result.data.revision};
  }
  function setConflict(value) {
    conflict = value;
    status('Нужно выбрать версию коллекции · открой «Мой аккаунт»');
    render();
  }
  async function sync() {
    if (!client || !user || busy || !initialized || conflict) return;
    if (!navigator.onLine) { status(state.dirty ? 'Нет интернета · изменения ждут отправки' : 'Нет интернета · локальная копия'); return; }
    if (storageChanged()) { status('Данные изменены в другой вкладке · обнови страницу'); return; }
    const token = epoch, id = user.id;
    busy = true;
    status('Синхронизация…');
    const current = () => token === epoch && user?.id === id;
    try {
      const cloud = await remote(id);
      if (!current() || storageChanged()) return;
      if (!state.dirty) {
        const changed = !same(state.groups, cloud.groups);
        cache({...cloud, dirty:false});
        if (changed) apply(state.groups);
      } else if (same(state.groups, cloud.groups)) {
        // A previous request may have succeeded while its response was lost.
        cache({...cloud, dirty:false});
      } else if (state.revision !== cloud.revision) {
        setConflict(cloud); return;
      } else {
        const sent = clone(state.groups);
        const result = await client.rpc('pan_save_collection', {p_groups:sent, p_revision:state.revision});
        if (!current() || storageChanged()) return;
        if (result.error) {
          if (result.error.code === '40001') {
            const latest = await remote(id);
            if (current()) setConflict(latest);
            return;
          }
          throw result.error;
        }
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!row || !Number.isSafeInteger(row.revision)) throw new Error('Invalid response');
        cache({...state, revision:row.revision, dirty:!same(state.groups, sent)});
      }
      status(state.dirty ? 'Сохранено на устройстве · ожидает отправки' : 'Синхронизировано с облаком');
      render();
    } catch (error) {
      if (current()) { status('Облако недоступно · локальная копия сохранена'); message(readable(error)); }
    } finally {
      busy = false;
      if (current() && state.dirty && !conflict && navigator.onLine) {
        // Retry is periodic on errors; immediate only for edits during a successful save.
        if (el('syncStatus').textContent === 'Сохранено на устройстве · ожидает отправки') setTimeout(sync, 100);
      }
    }
  }
  async function sessionChanged(session, event) {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (initialized && (session?.user?.id || null) === (user?.id || null)) {
      if (session?.user) user = session.user;
      render();
      if (recovery && !dialog.open) dialog.showModal();
      return;
    }
    epoch++;
    user = session?.user || null;
    conflict = null;
    if (archiveDialog.open) archiveDialog.close();
    try {
      state = load(cacheKey()) || {groups:empty(), revision:0, dirty:false};
      lastStored = localStorage.getItem(cacheKey());
    } catch (_) {
      state = {groups:empty(), revision:0, dirty:false};
      lastStored = localStorage.getItem(cacheKey());
      message('Не удалось прочитать копию. Скачай её из браузера перед очисткой данных.');
    }
    apply(state.groups);
    initialized = true;
    render();
    status(user ? 'Проверяем облачную коллекцию…' : 'Сохранено на этом устройстве');
    if (recovery && !dialog.open) dialog.showModal();
    await sync();
  }
  async function authAction(action) {
    if (!client || authBusy) return;
    authBusy = true;
    const buttons = el('accountForm').querySelectorAll('button');
    buttons.forEach(b => b.disabled = true);
    message('Подожди…');
    try {
      await action();
    } catch (error) { message(readable(error)); }
    finally { authBusy = false; buttons.forEach(b => b.disabled = false); }
  }
  el('accountForm').addEventListener('submit', event => {
    event.preventDefault();
    const signup = event.submitter?.id === 'accountSignUp';
    const credentials = {email:el('accountEmail').value.trim(), password:el('accountPassword').value};
    authAction(async () => {
      const result = signup ? await client.auth.signUp({...credentials, options:{emailRedirectTo:redirect()}}) : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      el('accountPassword').value = '';
      message(signup && !result.data.session ? 'Проверь почту: открой письмо и подтверди адрес. Затем войди здесь.' : 'Вход выполнен.');
      if (result.data.session) await sessionChanged(result.data.session);
    });
  });
  el('accountReset').addEventListener('click', () => {
    if (!el('accountEmail').reportValidity()) return;
    authAction(async () => {
      const result = await client.auth.resetPasswordForEmail(el('accountEmail').value.trim(), {redirectTo:redirect()});
      if (result.error) throw result.error;
      message('Если аккаунт существует, на эту почту придёт ссылка для смены пароля.');
    });
  });
  el('newPasswordForm').addEventListener('submit', event => {
    event.preventDefault();
    authAction(async () => {
      const result = await client.auth.updateUser({password:el('newPassword').value});
      if (result.error) throw result.error;
      el('newPassword').value = ''; recovery = false; render(); message('Пароль изменён.');
    });
  });
  el('accountOpen').addEventListener('click', () => { render(); dialog.showModal(); });
  el('accountClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { el('accountPassword').value = ''; el('newPassword').value = ''; });
  el('accountSync').addEventListener('click', sync);
  el('accountSignOut').addEventListener('click', () => authAction(async () => {
    if (state.dirty && !confirm('Есть изменения, которые ещё не отправлены. Они останутся на этом устройстве для этого аккаунта. Выйти?')) return;
    const result = await client.auth.signOut({scope:'local'});
    if (result.error) throw result.error;
    recovery = false;
    await sessionChanged(null);
    message('Ты вышла из аккаунта. Показана отдельная локальная коллекция.');
  }));
  el('accountMigrate').addEventListener('click', () => {
    if (!user || busy) return;
    try {
      const guest = load(GUEST);
      if (!guest || !confirm('Заменить коллекцию аккаунта локальной коллекцией этого браузера? Локальная копия останется.')) return;
      if (write(guest.groups)) { apply(state.groups); message('Коллекция перенесена на устройство аккаунта и ожидает синхронизации.'); }
    } catch (_) { message('Не удалось прочитать локальную коллекцию.'); }
  });
  el('syncUseCloud').addEventListener('click', () => {
    if (!conflict || busy || !confirm('Загрузить облачную версию? Текущие несинхронизированные изменения будут заменены. Можно сначала скачать копию.')) return;
    try { cache({...conflict, dirty:false}); conflict = null; apply(state.groups); render(); sync(); }
    catch (_) { message('Не удалось сохранить копию на устройстве.'); }
  });
  el('syncUseLocal').addEventListener('click', () => {
    if (!conflict || busy || !confirm('Заменить облачную коллекцию текущей? Изменения другого устройства будут заменены.')) return;
    try { cache({...state, revision:conflict.revision, dirty:true}); conflict = null; render(); sync(); }
    catch (_) { message('Не удалось сохранить копию на устройстве.'); }
  });
  el('accountExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({version:1, groups:state.groups}, null, 2)], {type:'application/json'});
    const url = window.URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'my-project-pan-' + localDateISO() + '.json'; a.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  });
  el('accountImport').addEventListener('change', async event => {
    const file = event.target.files[0];
    const token = epoch;
    try {
      if (!file) return;
      if (file.size > 5000000) throw new Error('Слишком большой файл');
      const parsed = JSON.parse(await file.text());
      const groups = normalize(parsed.groups);
      if (token !== epoch) return;
      if (!confirm('Заменить текущую коллекцию данными из этой копии?')) return;
      if (write(groups)) { apply(state.groups); render(); message('Копия загружена.'); }
    } catch (_) { message('Не удалось загрузить копию. Нужен JSON-файл коллекции размером до 5 МБ.'); }
    finally { event.target.value = ''; }
  });
  el('accountDelete').addEventListener('click', () => authAction(async () => {
    if (!user || prompt('Аккаунт и облачная коллекция будут удалены без возможности восстановления. Для подтверждения напиши УДАЛИТЬ') !== 'УДАЛИТЬ') return;
    const id = user.id;
    epoch++; // Ignore outstanding reads/writes for the account being deleted.
    const result = await client.rpc('pan_delete_account');
    if (result.error) throw result.error;
    localStorage.removeItem('project-pan.user.v2.' + id);
    await client.auth.signOut({scope:'local'});
    recovery = false;
    await sessionChanged(null);
    message('Аккаунт и облачные данные удалены. Отдельная гостевая коллекция не изменена.');
  }));
  window.addEventListener('online', sync);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('storage', event => {
    if (event.key === cacheKey()) status('Коллекция изменена в другой вкладке · обнови страницу');
  });
  setInterval(() => { if (!document.hidden) sync(); }, 30000);
  window.PanCloud = {write, sync};
  async function init() {
    try {
      // Migrate an actual saved collection, never the original author's embedded demo.
      if (!localStorage.getItem(GUEST) && localStorage.getItem(LEGACY)) {
        const saved = JSON.parse(localStorage.getItem(LEGACY));
        const groups = normalize(saved.groups);
        localStorage.setItem(GUEST, JSON.stringify({groups, revision:0, dirty:false}));
      }
      if (!window.supabase) throw new Error('SDK unavailable');
      client = window.supabase.createClient(URL, KEY, {auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event, session) => {
        // Never await another SDK call inside this callback: it holds an auth lock.
        setTimeout(() => sessionChanged(session, event).catch(() => message('Не удалось загрузить аккаунт. Обнови страницу.')), 0);
      });
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      await sessionChanged(result.data.session);
    } catch (_) {
      await sessionChanged(null);
      message('Вход временно недоступен. Локальная коллекция работает. Проверь интернет и обнови страницу.');
    }
  }
  init();
})();
