import { renderProjectPreview } from './renderPreview.ts'
let message=''
for await(const chunk of process.stdin)message+=chunk
try {
  const {input,layout}=JSON.parse(message)
  process.stdout.write(JSON.stringify(await renderProjectPreview(input,layout)))
} catch(error) {
  console.error(error instanceof Error?error.message:String(error))
  process.exitCode=1
}
