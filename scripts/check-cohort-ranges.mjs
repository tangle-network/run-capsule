#!/usr/bin/env node
/**
 * Fail a manifest that would publish an exact first-party version pin.
 *
 * An exact pin names one version and refuses every other, so a consumer that
 * already holds a later `@tangle-network/*` package installs a SECOND physical
 * copy of the pinned one. Two copies of `@tangle-network/agent-interface` in a
 * tree means two class identities and `instanceof` answering false across them.
 *
 * The range shape follows the depended-on package's own versioning: a caret
 * from 1.0.0, where a minor is additive; the narrower `>=X.Y.Z <X.Y+1.0` window
 * below 1.0, where a minor may remove.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const exactVersion = /^\d+\.\d+\.\d+(?:[-+].*)?$/
const offenders = []

for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
    if (!name.startsWith('@tangle-network/')) continue
    if (typeof spec === 'string' && exactVersion.test(spec)) {
      offenders.push(`${section}.${name} = ${spec}`)
    }
  }
}

if (offenders.length > 0) {
  process.stderr.write(
    `${manifest.name} publishes exact first-party version pins, which duplicate the package for every consumer already holding a later one:\n${offenders
      .map((entry) => `  ${entry}`)
      .join('\n')}\nDeclare a range instead: a caret from 1.0.0, or ">=X.Y.Z <X.Y+1.0" below it.\n`,
  )
  process.exit(1)
}

process.stdout.write(`${manifest.name}@${manifest.version} declares first-party ranges only\n`)
