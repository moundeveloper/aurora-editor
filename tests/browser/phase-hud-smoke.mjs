import { chromium } from 'playwright-core'
import { mkdir,writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({channel:'chrome',headless:true})
const timeout=setTimeout(()=>void browser.close(),90000)
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}))
  await page.goto('http://localhost:5173/')
  await page.getByRole('button',{name:'Create animated HUD · 12s portrait',exact:true}).click({timeout:60000})
  await page.getByRole('button',{name:'3D',exact:true}).click({timeout:30000})
  await page.locator('canvas[aria-label="3D scene editor viewport"]').waitFor()
  const result=await page.evaluate(async()=>{
    const {useEditorStore}=await import('/src/stores/editor.ts')
    const store=useEditorStore();const times=[]
    for(const t of [0,3,6,9,12]){const start=performance.now();store.currentTime=t;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));times.push(performance.now()-start)}
    store.currentTime=3
    return {name:store.project.name,objects:store.selectedScene.objects.length,times,scanKeys:store.selectedScene.objects.find(o=>o.id==='scan-1').transform.position.y.keyframes.length}
  })
  assert.equal(result.objects,15);assert.equal(result.scanKeys,5);assert.deepEqual(errors,[])
  await mkdir('artifacts/phase-hud',{recursive:true})
  await page.screenshot({path:'artifacts/phase-hud/editor.png'})
  await writeFile('artifacts/phase-hud/ui-check.json',JSON.stringify({result,errors},null,2))
  console.log(JSON.stringify(result))
}finally{clearTimeout(timeout);await browser.close()}
