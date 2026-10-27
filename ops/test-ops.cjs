// Integration checks: synthetic inputs and temporary local metrics only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-backend-test-'));
const run = (name, args, env = {}) => cp.spawnSync(process.execPath,[path.join(repo,name),...args],{encoding:'utf8',env:{...process.env,...env}});
(async()=>{
try {
  const live = require(path.join(repo,'collector/build-live.js'));
  assert.equal(live.parseGpus('0, Example GPU, GPU-fixture, 100, 1000, 20, 40, 50, 800')[0].mem_free,800);
  assert.throws(()=>live.parseGpus('0, Example GPU, GPU-fixture, 900, 1000, 20, 40, 50, 200'));
  const failed=await live.collect({readFile:async()=>{throw Error('fixture');},run:async()=>{throw Error('fixture');},now:()=>1000000});
  assert.equal(failed.sampleStartedAtMs,1000000);assert.equal(failed.ts,1000);assert.equal(failed.errors.length,9);
  const full = cp.spawnSync('bash',[path.join(repo,'collector/collector.sh')],{encoding:'utf8',env:{...process.env,HOMEPAGE_ROOT:root}});
  assert.equal(full.status,0,full.stderr);
  const status=JSON.parse(fs.readFileSync(path.join(root,'www/data/status.json')));
  assert.equal(status.hardware.vms.length,0);assert.equal(status.storage.mounts.length,0);
  assert.deepEqual(Object.keys(status.apps),['voice_detail']);
  assert.equal(fs.statSync(path.join(root,'raw')).mode&0o777,0o700);
  assert.equal(fs.statSync(path.join(root,'www/data')).mode&0o777,0o755);
  const liveRun=run('collector/build-live.js',['--write',path.join(root,'www/data/live.json')]);
  assert.equal(liveRun.status,0,liveRun.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'www/data/live.json'))).version,1);
  console.log('PASS collector parsing, partial failures, actual local collection, atomic live write');

  const hook=path.join(root,'weather-fixture.cjs');
  fs.writeFileSync(hook,`global.fetch=async()=>({ok:true,json:async()=>({current:{time:new Date(Date.now()+8*3600*1000).toISOString().slice(0,16),temperature_2m:20,weather_code:0}})});`);
  let weather=run('ops/weather-snapshot.js',[],{HOMEPAGE_ROOT:root,NODE_OPTIONS:'--require='+hook});
  assert.equal(weather.status,0,weather.stderr);
  const snap=path.join(root,'www/static/weather/home.json');
  assert.equal(JSON.parse(fs.readFileSync(snap)).location,'云栖');
  const before=fs.readFileSync(snap,'utf8');
  fs.writeFileSync(hook,`global.fetch=async()=>{throw Error('synthetic upstream unavailable');};`);
  weather=run('ops/weather-snapshot.js',[],{HOMEPAGE_ROOT:root,NODE_OPTIONS:'--require='+hook});
  assert.equal(weather.status,1);assert.equal(fs.readFileSync(snap,'utf8'),before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/weather-health.json'))).consecutiveFailures,1);
  console.log('PASS weather synthetic success/failure, cloud city config and snapshot preservation');

  const log=path.join(root,'synthetic-access.jsonl'),state=path.join(root,'private/stats.json'),output=path.join(root,'www/static/site-stats.json'),fails=path.join(root,'fails.json');
  fs.writeFileSync(log,JSON.stringify({ts:Date.now()/1000,status:200,resp_headers:{'Content-Type':['text/html']},request:{method:'GET',uri:'/',remote_ip:'192.0.2.123',headers:{'User-Agent':['Example Browser']}}})+'\n');
  fs.writeFileSync(fails,'{}');
  const stats=require(path.join(repo,'ops/site-stats.js'));
  let result=stats.collect({log,state,output,fails,www:path.join(root,'www')});
  // The collector output has no index, so create one then rerun a distinct new line.
  assert.equal(result.total_views,0);
  fs.writeFileSync(path.join(root,'www/index.html'),'example');
  fs.appendFileSync(log,JSON.stringify({ts:Date.now()/1000,status:200,resp_headers:{'Content-Type':['text/html']},request:{method:'GET',uri:'/',remote_ip:'192.0.2.123',headers:{'User-Agent':['Example Browser']}}})+'\n');
  result=stats.collect({log,state,output,fails,www:path.join(root,'www')});
  assert.equal(result.total_views,1);assert.equal(result.today_visitors,1);
  assert.equal(stats.collect({log,state,output,fails,www:path.join(root,'www')}).total_views,1);
  assert.equal(fs.statSync(state).mode&0o777,0o600);
  assert(!fs.readFileSync(output,'utf8').includes('192.0.2.123'));
  console.log('PASS stats synthetic counting, offset idempotency, aggregate-only output and mode 600 state');

  const entry=path.join(repo,'config/change-log-entry.example.json');
  let journal=run('ops/change-log.js',['--root',root,'append',entry]);assert.equal(journal.status,0,journal.stderr);
  const canonical=path.join(root,'data/server-changes.json'),saved=fs.readFileSync(canonical,'utf8');
  journal=run('ops/change-log.js',['--root',root,'append',entry]);assert.equal(journal.status,0,journal.stderr);assert.equal(fs.readFileSync(canonical,'utf8'),saved);
  assert.equal(fs.statSync(canonical).mode&0o777,0o600);
  const html=fs.readFileSync(path.join(root,'www/yeti/server/log/index.html'),'utf8');
  assert(!html.includes('__JOURNAL_DATA__'));
  let checked=0;
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if(/application\/json/.test(match[1])||/src=/.test(match[1]))continue;
    const script=path.join(root,`inline-${checked++}.js`);fs.writeFileSync(script,match[2]);
    const result=cp.spawnSync(process.execPath,['--check',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  console.log('PASS journal example append/render, duplicate idempotency, private canonical and inline JS checks:',checked);
} finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
