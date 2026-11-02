import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
 create role anon;
 create role authenticated;
 create schema auth;
 create table auth.users (id uuid primary key);
 create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon;
`);
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
await db.exec(schema);
await db.exec(schema); // setup is rerunnable
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
await db.query('insert into auth.users values ($1),($2)', [a,b]);
const groups = {tableBody:[],skFaceTableBody:[],skBodyTableBody:[]};
const query = () => db.query('select * from public.pan_save_collection($1::jsonb,$2)', [JSON.stringify(groups),0]);
async function asUser(id) {
 await db.exec('reset role; set role authenticated;');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
}
await asUser(a);
assert.equal((await query()).rows[0].user_id,a);
await assert.rejects(query, /changed on another device/);
await assert.rejects(() => db.query('update public.pan_collections set revision=100'), /permission denied/);
await assert.rejects(() => db.query('insert into public.pan_collections(user_id,groups) values ($1,$2)',[b,groups]), /permission denied/);
await asUser(b);
assert.equal((await db.query('select * from public.pan_collections')).rows.length,0);
assert.equal((await query()).rows[0].user_id,b);
await asUser(a);
const rows = (await db.query('select * from public.pan_collections')).rows;
assert.equal(rows.length,1);
assert.equal(rows[0].user_id,a);
assert.equal((await db.query('select * from public.pan_save_collection($1,1)',[groups])).rows[0].revision,2);
await assert.rejects(() => db.query('select * from public.pan_save_collection($1,1)',[groups]), /changed on another device/);
await assert.rejects(() => db.query("select * from public.pan_save_collection('{}',2)"), /pan_groups_shape/);
await asUser('');
await assert.rejects(query, /Sign in required/);
await db.exec('reset role; set role anon;');
await assert.rejects(query, /permission denied/);
await asUser(a);
await db.query('select public.pan_delete_account()');
await db.exec('reset role;');
assert.equal((await db.query('select * from public.pan_collections')).rows[0].user_id,b);
assert.equal((await db.query('select * from auth.users')).rows[0].id,b);
console.log('PASS: SQL idempotency, RLS account isolation, anonymous denial, guarded writes, revision conflicts, validation, own-account deletion and cascade.');
await db.close();
