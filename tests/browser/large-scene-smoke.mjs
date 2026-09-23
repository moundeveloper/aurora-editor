// Real editor smoke/profile run in an isolated browser context. All HTTP writes are intercepted.
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const projectId=process.argv[2]??'31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f'
const label=process.argv[3]??'after'
const browser=await chromium.launch({channel:'chrome',headless:true})
const watchdog=setTimeout(()=>{console.error('Editor diagnostic exceeded 90 seconds');void browser.close()},90000)
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.fulfill({status:200,contentType:'application/json',body:'{}'}))
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.text().startsWith('PROFILE'))console.log(message.text())})
  const start=Date.now()
  await page.goto(`${process.env.AURORA_APP_URL??'http://localhost:5173'}/projects/${projectId}`)
  await page.waitForFunction(async id=>{const {useEditorStore}=await import('/src/stores/editor.ts');const store=useEditorStore();return store.project.id===id&&!store.projectBrowserBusy},projectId,{timeout:60000})
  await page.getByRole('button',{name:'3D',exact:true}).click({timeout:60000})
  await page.locator('canvas[aria-label="3D scene editor viewport"]').waitFor({timeout:60000})
  const loadMs=Date.now()-start
  console.log('PROFILE editor loaded',loadMs)
  const result=await page.evaluate(async()=>{
    const {useEditorStore}=await import('/src/stores/editor.ts')
    const store=useEditorStore()
    console.log('PROFILE store ready')
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    await settle()
    const ticks=[],selections=[]
    for(let i=0;i<8;i++){const start=performance.now();store.currentTime=(i+1)/30;await settle();ticks.push(performance.now()-start);console.log('PROFILE tick',i,ticks.at(-1))}
    for(const object of store.selectedScene.objects.slice(0,4)){const start=performance.now();store.selectedSceneEntityId=object.id;await settle();selections.push(performance.now()-start)}
    const object=store.selectedScene.objects[0],original=object.transform.position.x.value
    const editStart=performance.now();object.transform.position.x.value+=.1;store.markSceneChanged();const editMs=performance.now()-editStart
    await settle()
    const undoStart=performance.now();store.undo();const undoMs=performance.now()-undoStart
    await settle()
    if(store.selectedScene.objects[0].transform.position.x.value!==original)throw new Error('Undo failed to restore object position')
    const sustained=[]
    for(let i=0;i<240;i++){
      const start=performance.now();store.currentTime=(i/30)%store.project.duration
      await settle();sustained.push(performance.now()-start)
    }
    const ordered=[...sustained].sort((a,b)=>a-b)
    return {ticks,selections,editMs,undoMs,assets:store.assets.length,objects:store.selectedScene.objects.length,sustained:{frames:240,medianMs:ordered[120],p95Ms:ordered[228],includesTwoAnimationFrames:true}}
  })
  await mkdir('artifacts/crimson-citadel',{recursive:true})
  await page.screenshot({path:`artifacts/crimson-citadel/editor-${label}.png`})
  const report={loadMs,...result,errors}
  await writeFile(`artifacts/crimson-citadel/editor-${label}.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  if(errors.length)process.exitCode=1
} finally {clearTimeout(watchdog);await browser.close()}
