import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { RenderPreviewRequest, RenderPreviewResult } from '../../shared/renderPreview.ts'
import type { VaultLayout } from '../../server/src/storage/paths.ts'

/** Keep Vite's generated modules outside the HTTP server's Node --watch graph. */
export function renderProjectPreviewIsolated(input: RenderPreviewRequest, layout: VaultLayout) {
  return new Promise<{summary:Omit<RenderPreviewResult,'png'> & {path:string};png:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./renderPreviewWorker.ts',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',errors=''
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Scene preview exceeded three minutes'))},180000)
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
    child.stdout.on('data',(chunk:string)=>{output+=chunk})
    child.stderr.on('data',(chunk:string)=>{errors=(errors+chunk).slice(-8000)})
    child.on('error',error=>{clearTimeout(timeout);reject(error)})
    child.stdin.on('error',error=>{clearTimeout(timeout);reject(error)})
    child.on('close',code=>{
      clearTimeout(timeout)
      if(code!==0){reject(new Error(errors||`Preview process exited with code ${code}`));return}
      try{resolve(JSON.parse(output))}catch{reject(new Error('Preview process returned invalid output'))}
    })
    child.stdin.end(JSON.stringify({input,layout}))
  })
}
