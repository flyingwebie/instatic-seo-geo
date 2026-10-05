import { mkdir, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const projectDir = resolve(import.meta.dir, '..')
const instaticDir = resolve(process.env.INSTATIC_DIR || join(projectDir, '../../Instatic'))
const command = process.argv[2]

if (!['setup', 'lint', 'typecheck', 'build', 'dev'].includes(command ?? '')) {
  throw new Error('Use bun run setup, lint, typecheck, build, or dev.')
}

const sdkPath = join(instaticDir, 'src/core/plugin-sdk/index.ts')
const cliPath = join(instaticDir, 'src/core/plugin-sdk/cli/index.ts')
const hostTsconfig = join(instaticDir, 'tsconfig.app.json')

for (const path of [sdkPath, cliPath, hostTsconfig]) {
  if (!await Bun.file(path).exists()) {
    throw new Error(`Instatic checkout is missing ${path}. Set INSTATIC_DIR to an installed Instatic checkout.`)
  }
}

const generatedDir = join(projectDir, '.instatic')
await mkdir(generatedDir, { recursive: true })
// SDK editor interfaces rely on the host middleware's TypeScript augmentation.
// A type-only import loads it without putting middleware into plugin bundles.
await Bun.write(join(generatedDir, 'sdk.ts'), [
  `import type {} from ${JSON.stringify(join(instaticDir, 'node_modules/zustand-mutative'))}`,
  `export * from ${JSON.stringify(sdkPath)}`,
  '',
].join('\n'))
await Bun.write(join(generatedDir, 'tsconfig.json'), JSON.stringify({
  extends: hostTsconfig,
  compilerOptions: {
    types: ['bun', 'vite/client'],
    typeRoots: [
      join(projectDir, 'node_modules/@types'),
      join(instaticDir, 'node_modules/@types'),
      join(instaticDir, 'node_modules'),
    ],
  },
}, null, 2) + '\n')

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn(args, {
    cwd: projectDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}

async function typecheck(): Promise<void> {
  await run([process.execPath, join(projectDir, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'])
}

switch (command) {
  case 'setup':
    console.info(`Instatic SDK: ${instaticDir}`)
    break
  case 'typecheck':
    await typecheck()
    break
  case 'lint':
    await run([process.execPath, join(projectDir, 'node_modules/eslint/bin/eslint.js'), '.'])
    await run([process.execPath, cliPath, 'lint', projectDir])
    break
  case 'build':
    await typecheck()
    await run([process.execPath, cliPath, 'build', projectDir])
    await mkdir(join(projectDir, 'artifacts'), { recursive: true })
    await rename(join(projectDir, '../seo-geo.plugin.zip'), join(projectDir, 'artifacts/seo-geo.plugin.zip'))
    console.info(`Plugin ZIP: ${join(projectDir, 'artifacts/seo-geo.plugin.zip')}`)
    break
  case 'dev':
    await run([
      process.execPath, cliPath, 'dev', projectDir,
      '--uploads', process.env.INSTATIC_UPLOADS_DIR || join(instaticDir, 'uploads'),
    ])
    break
}
