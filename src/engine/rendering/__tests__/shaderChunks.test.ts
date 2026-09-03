import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const engineRoot = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/**
 * Three prepends its own shader chunks — `colorspace_pars_fragment` among them — to every
 * ShaderMaterial it compiles. A hand-written `#include` of one of those chunks therefore redefines
 * its functions, the fragment shader fails to compile, and every draw using that material is
 * silently skipped: the viewport goes blank with nothing but a `useProgram: program not valid`
 * warning to show for it. Three's own chunk names are the trap, so the whole family is banned.
 */
describe('engine shader sources', () => {
  it('never re-includes a Three shader chunk that Three already injects', () => {
    const offenders = sourceFiles(engineRoot)
      .flatMap((path) => readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => /#include\s*</.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : []))

    expect(offenders).toEqual([])
  })
})
