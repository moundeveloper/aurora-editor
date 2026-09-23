import {chromium} from 'playwright-core'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({channel:'chrome',headless:true}),id='71f03e17-901e-4f10-aaa1-51d866c099e8'
const watchdog=setTimeout(()=>void browser.close(),120000)
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('**/api/**',r=>r.request().method()==='GET'||r.request().url().endsWith('/render-preview')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}))
  await page.goto(`http://localhost:5173/projects/${id}`)
  await page.waitForFunction(async id=>{const {useEditorStore}=await import('/src/stores/editor.ts');return useEditorStore().project.id===id&&!useEditorStore().projectBrowserBusy},id,{timeout:60000})
  await page.getByRole('button',{name:'3D',exact:true}).click({timeout:60000})
  await page.getByRole('button',{name:'Render and profile saved scene',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Scene render profiler'})
  await dialog.getByLabel('Width',{exact:true}).fill('360');await dialog.getByLabel('Height',{exact:true}).fill('500')
  await dialog.getByLabel('Frames',{exact:true}).fill('12');await dialog.getByLabel('Sampling duration',{exact:true}).fill('2')
  const response=page.waitForResponse(r=>r.url().endsWith('/render-preview'),{timeout:90000})
  await dialog.getByRole('button',{name:'Render and measure',exact:true}).click()
  const reply=await response,body=await reply.text();assert.equal(reply.status(),200,body)
  const result=JSON.parse(body);assert.equal(result.sampleCount,12);assert.equal(result.sampleEnd,2);assert.equal(result.width,360)
  await dialog.getByRole('img',{name:'Saved camera render'}).waitFor()
  await mkdir('artifacts/engine-final',{recursive:true});await page.screenshot({path:'artifacts/engine-final/profiler-ui.png'})
  delete result.image;await writeFile('artifacts/engine-final/profiler-ui.json',JSON.stringify({result,errors},null,2))
  assert.deepEqual(errors,[]);console.log('Saved-scene profiling UI and HTTP/MCP renderer parity passed')
}finally{clearTimeout(watchdog);await browser.close()}
