import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { SharedSerializedProject } from '../../../shared/contracts.ts'
const compress=promisify(gzip),expand=promisify(gunzip)
const marker='auroraGeometryGzipV1'

/** Portable, lossless compressed model blobs. Manifests commit only after every blob exists. */
export async function packGeometry(snapshot:SharedSerializedProject,directory:string) {
  await mkdir(directory,{recursive:true})
  const assets=await Promise.all(snapshot.assets.map(async asset=>{
    if(!asset.nativeModel)return asset
    const bytes=Buffer.from(JSON.stringify(asset.nativeModel)),hash=createHash('sha256').update(bytes).digest('hex')
    const target=join(directory,`${hash}.json.gz`)
    try { await access(target) } catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
      const temporary=join(directory,`.${hash}-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary,await compress(bytes),{flag:'wx'})
        // Windows may reject replacement while a concurrent publisher is closing
        // the same target. Accept that race only after verifying the winning blob.
        try { await rename(temporary,target) } catch(error) {
          let winner:Buffer
          try { winner=await expand(await readFile(target)) } catch { throw error }
          if(createHash('sha256').update(winner).digest('hex')!==hash)throw error
        }
      }
      finally { await rm(temporary,{force:true}) }
    }
    return {...asset,nativeModel:{[marker]:hash}}
  }))
  return {...snapshot,assets}
}

export async function unpackGeometry(snapshot:SharedSerializedProject,directory:string) {
  const cache=new Map<string,Promise<unknown>>()
  const assets=await Promise.all(snapshot.assets.map(async asset=>{
    const model=asset.nativeModel as Record<string,unknown>|undefined
    if(!model || !(marker in model))return asset
    const hash=model[marker]
    if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid geometry blob reference')
    let pending=cache.get(hash)
    if(!pending){pending=(async()=>{
      const bytes=await expand(await readFile(join(directory,`${hash}.json.gz`)))
      if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Geometry blob integrity check failed')
      return JSON.parse(bytes.toString('utf8')) as unknown
    })();cache.set(hash,pending)}
    // Assets remain independent mutable documents even when their on-disk blobs are deduplicated.
    return {...asset,nativeModel:structuredClone(await pending)}
  }))
  return {...snapshot,assets}
}
