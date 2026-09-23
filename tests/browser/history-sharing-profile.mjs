// Read-only comparison of checkpoint cloning against the previous full-JSON path.
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const id=process.argv[2]??'31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f'
const browser=await chromium.launch({channel:'chrome',headless:true})
const timeout=setTimeout(()=>void browser.close(),90000)
try{
  const page=await browser.newPage()
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}))
  await page.goto(`http://localhost:5173/projects/${id}`)
  await page.waitForFunction(async id=>{const {useEditorStore}=await import('/src/stores/editor.ts');const s=useEditorStore();return s.project.id===id&&!s.projectBrowserBusy},id,{timeout:60000})
  await page.getByRole('button',{name:'3D',exact:true}).click({timeout:60000})
  const result=await page.evaluate(async()=>{
    const [{useEditorStore},{HistoryStatePool},{serializeEditorState},{toRaw}]=await Promise.all([import('/src/stores/editor.ts'),import('/src/engine/project/historyState.ts'),import('/src/engine/project/serialization.ts'),import('/node_modules/.vite/deps/vue.js')])
    const store=useEditorStore(),state={}
    for(const key of ['project','layers','assets','scenes3D','nodes','nodeConnections','rigs','audioGraph'])state[key]=toRaw(store[key])
    const pool=new HistoryStatePool();pool.capture(state)
    if(!state.assets.some(a=>a.nativeModel?.revisions.length))throw new Error('Profile requires a fully loaded project with published native models')
    const old=[],pooled=[],snapshots=[]
    for(let i=0;i<6;i++){
      const legacy=()=>{const start=performance.now();JSON.parse(serializeEditorState(state));old.push(performance.now()-start)}
      const shared=()=>{const start=performance.now();snapshots.push(pool.capture(state));pooled.push(performance.now()-start)}
      if(i%2){shared();legacy()}else{legacy();shared()}
    }
    const revisions=snapshots.flatMap(s=>s.assets.flatMap(a=>a.nativeModel?.revisions??[]))
    return {legacyCloneMs:old,pooledCloneMs:pooled,snapshots:snapshots.length,publishedRevisionReferences:revisions.length,uniquePublishedRevisionObjects:new Set(revisions).size}
  })
  await mkdir('artifacts/engine-final',{recursive:true})
  await writeFile('artifacts/engine-final/history-sharing.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}finally{clearTimeout(timeout);await browser.close()}
