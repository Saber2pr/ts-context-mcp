import { PromptEngine } from './index'

const engine = new PromptEngine(process.cwd())

console.log(engine.getMethodImplementation('src/engine.ts', 'getRepoMap'))
