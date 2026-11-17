/**
 * Locates the pinned DeepSeek Harness checkout and resolves the third-party
 * packages it already installs, so this repository adds no second dependency tree.
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of this repository. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute path of the upstream checkout; `DSH_BASE` overrides the sibling default. */
export const BASE = resolve(process.env.DSH_BASE ?? join(ROOT, '..', 'deepseekHarness', 'deepseek-harness'))

/** The wrapper that runs the upstream CLI with this distribution's home and environment. */
export const DSH = join(ROOT, 'scripts', 'dsh.sh')

/** Resolves packages installed for the upstream MCP client (MCP server SDK, zod). */
export const mcpRequire = createRequire(join(BASE, 'packages', 'mcp', 'mcp-client', 'package.json'))

/** Resolves packages installed at the upstream workspace root (vitest, js-yaml). */
export const rootRequire = createRequire(join(BASE, 'package.json'))
