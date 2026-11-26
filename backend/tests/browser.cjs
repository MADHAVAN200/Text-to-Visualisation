const {chromium}=require('playwright-core');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
const frontend=path.resolve('frontend');
const vite=spawn(process.execPath,[path.join(frontend,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:frontend,env:{...process.env,VITE_API_BASE:process.argv[2]},stdio:['ignore','pipe','inherit']});
let browser;
try {
const url=await new Promise((resolve,reject)=>{vite.stdout.on('data',d=>{const match=d.toString().replace(/\x1b\[[0-9;]*m/g,'').match(/http:\/\/127\.0\.0\.1:\d+\//);if(match)resolve(match[0])});vite.on('exit',()=>reject(new Error('Vite exited')))});
browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true});
const p=await browser.newPage({viewport:{width:1500,height:1000}});
p.setDefaultTimeout(30000);
await p.goto(url);
await p.getByPlaceholder('name@company.com').fill(process.env.BROWSER_EMAIL || 'Alice@example.test');
await p.locator('input[type=password]').fill(process.env.BROWSER_PASSWORD || 'test-only-password');
await p.locator('button[type=submit]').click();
await p.getByRole('link',{name:'Data',exact:true}).click();
await p.getByText(process.env.BROWSER_FIXTURE_NAME || 'Keyless funding',{exact:true}).first().waitFor();
await p.getByRole('link',{name:'Dashboards',exact:true}).click();
await p.getByLabel('Dashboard request').fill(process.env.BROWSER_REQUEST || 'Show me a dashboard of total budget and count of grants by sector in 2024');
await p.getByRole('button',{name:'Generate dashboard'}).click();

await p.locator('.recharts-bar-rectangle').first().waitFor();
if (process.env.BROWSER_DEBUG) console.log(await p.locator('body').innerText());
if (process.env.BROWSER_KPI) {
  const expected = Number(process.env.BROWSER_KPI);
  // API tests check every source value; here check the formatted KPI and chart.
  await p.getByText(process.env.BROWSER_KPI_DISPLAY || expected.toLocaleString('en-US'),{exact:true}).first().waitFor();
} else if (!process.env.BROWSER_NO_KPI) {
  await p.getByText(/^\$?340(?:\.00)?$/).first().waitFor();
  await p.getByText(/^3(?:\.00)?$/).first().waitFor();
}
for (const name of (process.env.BROWSER_LABELS || 'Arts,Science').split(',')) {
  const visible = async () => (await Promise.all((await p.getByText(name,{exact:true}).all()).map(l=>l.isVisible()))).some(Boolean);
  if (!await visible()) {
    // Responsive tick spacing can omit a label; its bar tooltip must still expose it.
    for (const bar of await p.locator('.recharts-bar-rectangle').all()) {
      await bar.hover();
      try { await p.getByText(name,{exact:true}).last().waitFor({state:'visible',timeout:250}); } catch {}
      if (await visible()) break;
    }
  }
  if (!await visible()) throw new Error('Missing chart category '+name);
}
console.log('Edge verified dashboard chart, KPI, and category labels');
}finally {if(browser)await browser.close();vite.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});


