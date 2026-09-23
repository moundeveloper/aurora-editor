import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect} from 'vitest'
import {packGeometry,unpackGeometry} from '../projects/geometryStorage.ts'
import {createModel,publishModel} from '../../../shared/modeling.ts'
import {createPhaseHudProject} from '../../../shared/phaseHud.ts'
import {serializedProjectSchema} from '../../../shared/contracts.ts'
import {ProjectRepository,projectETag} from '../projects/ProjectRepository.ts'
import {ensureVault,vaultLayout} from '../storage/paths.ts'
it('round trips binary models, deduplicates, rejects corrupt blobs and reads legacy inline data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aurora-geometry-'))
  try{
    const model=createModel();publishModel(model,1)
    const state=createPhaseHudProject();state.assets=[{id:'a',name:'a',kind:'model3d',nativeModel:model},{id:'b',name:'b',kind:'model3d',nativeModel:structuredClone(model)}]
    const parsed=serializedProjectSchema.parse(state)
    const packed=await packGeometry(parsed,root),restored=await unpackGeometry(packed,root)
    expect(restored).toEqual(parsed);expect(restored.assets[0]!.nativeModel).not.toBe(restored.assets[1]!.nativeModel)
    expect(await unpackGeometry(parsed,root)).toEqual(parsed)
    const files=await readdir(root);expect(files).toHaveLength(1);expect((await readFile(join(root,files[0]!)))[0]).toBe(31)
    await writeFile(join(root,files[0]!),Buffer.from('corrupt'));await expect(unpackGeometry(packed,root)).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
})
it('preserves repository ETags and reports missing geometry without losing project metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aurora-repository-'))
  try {
    const layout=await ensureVault(vaultLayout(root)),repository=new ProjectRepository(layout)
    const state=createPhaseHudProject(),model=createModel();publishModel(model,1)
    state.assets=[{id:'model',name:'Model',kind:'model3d',nativeModel:model}]
    const saved=await repository.save(state,'new'),loaded=await repository.load(saved.project.id)
    expect(loaded).toEqual(saved);expect(projectETag(loaded)).toBe(projectETag(saved))
    expect(JSON.parse(await readFile(join(layout.projects,`${saved.project.id}.aurora.json`),'utf8')).assets[0].nativeModel).toHaveProperty('auroraGeometryGzipV1')
    const directory=join(layout.projects,'.geometry'),[blob]=await readdir(directory)
    await rm(join(directory,blob!))
    expect(await repository.list()).toEqual([saved.project])
    await expect(repository.load(saved.project.id)).rejects.toThrow()
    await expect(repository.save(saved)).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
})
