import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { z } from 'zod';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const compile = (p) => ts.transpileModule(read(p), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const modules = new Map([['zod',{z}],['../fixtures/mangadex-refresh-series.json',JSON.parse(read('lib/fixtures/mangadex-refresh-series.json'))]]);
function load(p, name) { const exports={}; new Function('exports','require',compile(p))(exports,(id)=>{if(!modules.has(id)) throw new Error(id);return modules.get(id);});modules.set(name,exports);return exports; }
load('lib/commercial-settings.ts','../commercial-settings');
load('lib/server/public-content-visibility.ts','./public-content-visibility');
const {previewFixtureStatements}=load('lib/server/preview-fixtures.ts','fixtures');
const {extraCatalogFilters}=load('lib/server/catalog-extra-filters.ts','filters');
function database(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort()) db.exec(read(`drizzle/${file}`));return db;}
function seed(db){const adapter={prepare(sql){return {bind(...args){return {run(){try{return db.prepare(sql).run(...args);}catch(error){throw new Error(`${error.message}\n${sql}`,{cause:error});}}}}}}};for(const statement of previewFixtureStatements(adapter,['admin@example.test'],['a','b','c']))statement.run();}

test('preview fixtures are additive, repeatable, relationally valid, and cover the requested content',()=>{
 const db=database();try{
 db.exec("INSERT INTO users (id,email,display_name,primary_role,status) VALUES ('real-user','admin@example.test','Existing administrator','ADMINISTRATOR','ACTIVE')");
 seed(db);
 const count=(table)=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
 const counts=Object.fromEntries(['series','chapters','chapter_pages','reviews','discussion_comments','analytics_events','tags','homepage_sliders','content_discounts','site_announcements'].map(t=>[t,count(t)]));
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM series WHERE id LIKE 'pv4924-%'").get().n,20);
 assert.ok(counts.chapters>1000);assert.ok(counts.tags>10);assert.ok(counts.reviews>=57);assert.ok(counts.analytics_events>2000);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_memberships WHERE user_id='real-user'").get().n,3);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 seed(db);for(const [table,n] of Object.entries(counts))assert.equal(count(table),n,table);
 assert.equal(db.prepare("SELECT display_name FROM users WHERE id='real-user'").get().display_name,'Existing administrator');
 assert.ok(db.prepare("SELECT COUNT(*) AS n FROM chapters WHERE state='PUBLISHED' AND access_type='PAID'").get().n>0);
 }finally{db.close();}
});

test('origin, tag, and active sale predicates combine safely and honor paid visibility',()=>{
 const db=database();try{
 seed(db);
 const query=(params)=>{const f=extraCatalogFilters(new URLSearchParams(params));return db.prepare(`SELECT s.id,s.origin_country FROM series s WHERE ${f.clauses.join(' AND ')||'1'}`).all(...f.bindings);};
 assert.ok(query({origin:'JP'}).length>0);assert.ok(query({origin:'KR,CN'}).every(s=>['KR','CN'].includes(s.origin_country)));
 assert.ok(query({origin:'OTHER'}).every(s=>!['KR','CN','JP'].includes(s.origin_country)));
 const tag=db.prepare('SELECT slug FROM tags LIMIT 1').get().slug;
 assert.ok(query({tag}).length>0);assert.equal(query({tag:"' OR 1=1 --"}).length,0);
 const sales=query({onSale:'1'});assert.ok(sales.length>0);
 db.exec("UPDATE content_discounts SET starts_at=datetime('now','-2 days'),ends_at=datetime('now','-1 day')");assert.equal(query({onSale:'1'}).length,0);
 db.exec("UPDATE content_discounts SET ends_at=datetime('now','+1 day'); UPDATE feature_flags SET enabled=0 WHERE key='payments'");assert.equal(query({onSale:'1'}).length,0);
 }finally{db.close();}
});
