import { createPhaseHudProject } from '../../shared/phaseHud.ts'
import { renderProjectPreview } from './renderPreview.ts'
import { ensureVault, vaultLayout } from '../../server/src/storage/paths.ts'
const snapshot=createPhaseHudProject('PHASE / Design study')
const layout=await ensureVault(vaultLayout())
const result=await renderProjectPreview({snapshot,width:720,height:1000,time:Number(process.argv[2]??0),quality:'full',benchmarkFrames:2},layout)
console.log(JSON.stringify(result.summary,null,2))
