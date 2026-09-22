import { mkdir, writeFile, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import { chromium, type Browser } from 'playwright-core'
import type { RenderPreviewRequest, RenderPreviewResult } from '../../shared/renderPreview.ts'
import { blobPath, type VaultLayout } from '../../server/src/storage/paths.ts'

/** Isolated, read-only renderer: no editor store, autosave, live browser profile, or existing tab. */
export async function renderProjectPreview(input: RenderPreviewRequest, layout: VaultLayout) {
  const root = fileURLToPath(new URL('../../',import.meta.url))
  const server = await createServer({
    configFile:false,root,cacheDir:join(root,'node_modules','.vite-aurora-preview'),logLevel:'silent',resolve:{alias:{'@':join(root,'src')}},
    server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},
    plugins:[{name:'aurora-mcp-preview',configureServer(vite){
      vite.middlewares.use((req,res,next)=>{
        if(req.url==='/__aurora_preview__/document') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input));return}
        if(req.url==='/__aurora_preview__/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><script type="module" src="/src/engine/rendering/renderPreviewEntry.ts"></script></body></html>');return}
        const hash=req.url?.match(/^\/media\/([a-f0-9]{64})(?:\?.*)?$/)?.[1]
        if(hash){const stream=createReadStream(blobPath(layout,hash));stream.on('error',()=>{res.statusCode=404;res.end('Missing media blob')});stream.pipe(res);return}
        next()
      })
    }}],
  })
  let browser:Browser|undefined
  try {
    await server.listen()
    const address=server.httpServer!.address()
    if(!address||typeof address==='string')throw new Error('Preview server did not bind')
    const candidates=[process.env.AURORA_CHROMIUM_PATH,chromium.executablePath(),...(process.platform==='win32'?['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']:[])].filter((p):p is string=>Boolean(p))
    let executablePath:string|undefined
    for(const candidate of candidates){try{await access(candidate);executablePath=candidate;break}catch{/* Try the next installed browser. */}}
    if(!executablePath)throw new Error('No Chromium browser found. Install Chrome/Edge or set AURORA_CHROMIUM_PATH. See mcp/README.md.')
    browser=await chromium.launch({headless:true,executablePath,args:['--enable-webgl'],timeout:30000})
    const page=await browser.newPage({viewport:{width:input.width,height:input.height}})
    const errors:string[]=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(`http://127.0.0.1:${address.port}/__aurora_preview__/`,{waitUntil:'domcontentloaded',timeout:30000})
    await page.waitForFunction(()=>{const w=globalThis as unknown as Window;return Boolean(w.auroraPreviewResult||w.auroraPreviewError)},{},{timeout:120000})
    const result=await page.evaluate(()=>{const w=globalThis as unknown as Window;return {result:w.auroraPreviewResult,error:w.auroraPreviewError}})
    if(result.error||!result.result)throw new Error(result.error||errors.join('\n')||'Preview failed')
    const output=result.result as RenderPreviewResult
    const directory=join(layout.root,'renders');await mkdir(directory,{recursive:true})
    const path=join(directory,`${input.snapshot.project.id}-${Date.now()}-${randomUUID().slice(0,8)}.png`)
    const png=output.png.slice(output.png.indexOf(',')+1)
    await writeFile(path,Buffer.from(png,'base64'))
    const {png:_png,...summary}=output
    await writeFile(path.replace(/\.png$/,'.json'),JSON.stringify({...summary,path},null,2))
    return {summary:{...summary,path},png}
  } finally {await browser?.close();await server.close()}
}
