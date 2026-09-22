// Exercise real inspector controls without writing to the user's saved project.
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({channel:'chrome',headless:true})
const watchdog=setTimeout(()=>void browser.close(),90000)
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}))
  await page.goto(`${process.env.AURORA_APP_URL??'http://localhost:5173'}/projects/${process.argv[2]??'31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f'}`)
  await page.waitForFunction(async id=>{const {useEditorStore}=await import('/src/stores/editor.ts');const store=useEditorStore();return store.project.id===id&&!store.projectBrowserBusy},process.argv[2]??'31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f',{timeout:60000})
  await page.getByRole('button',{name:'3D',exact:true}).click({timeout:60000})
  await page.locator('canvas[aria-label="3D scene editor viewport"]').waitFor()
  const ao=page.getByRole('button',{name:'Ambient occlusion',exact:true})
  assert.equal(await ao.getAttribute('aria-pressed'),'true')
  await ao.click();assert.equal(await ao.getAttribute('aria-pressed'),'false')
  await ao.click();assert.equal(await ao.getAttribute('aria-pressed'),'true')
  const enable=page.getByRole('button',{name:'Enable scene color grading',exact:true})
  if(await enable.getAttribute('aria-pressed')!=='true')await enable.click()
  await page.getByLabel('Color grading saturation',{exact:true}).fill('0')
  await page.getByLabel('Color grading saturation',{exact:true}).press('Tab')
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const settings=await page.evaluate(async()=>{const {useEditorStore}=await import('/src/stores/editor.ts');return JSON.parse(JSON.stringify(useEditorStore().selectedScene.settings))})
  assert.equal(settings.colorGrade.saturation,0)
  assert.equal(settings.colorGrade.enabled,true)
  await page.screenshot({path:'artifacts/crimson-citadel/editor-grading.png'})
  await page.getByRole('button',{name:'Reset color grading',exact:true}).click()
  assert.equal(await enable.getAttribute('aria-pressed'),'false')
  assert.equal(await page.getByLabel('Color grading saturation',{exact:true}).inputValue(),'1')
  await writeFile('artifacts/crimson-citadel/scene-look-ui.json',JSON.stringify({settings,errors},null,2))
  assert.deepEqual(errors,[])
  console.log('Scene grading and AO inspector controls passed; saved project unchanged.')
}finally{clearTimeout(watchdog);await browser.close()}
