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

const FIRST_PARTY_SCOPE = '@tangle-network/'

// devDependencies are checked too: the studio bundle compiles `@tangle-network/*`
// build-time packages into the published artifact, so an exact pin there freezes
// the peer set the bundle is built against.
const CHECKED_SECTIONS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
]

// npm accepts a leading `=` (with optional space) and a leading `v` on an exact
// version, and trims the spec before parsing. Each spelling names one version.
const EXACT_VERSION = /^(?:=\s*)?v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/

/**
 * True when `spec` admits no version other than the ones it names.
 *
 * npm reads `A || B` as the union of its parts, so a union of exact versions is
 * still a closed set: no member of it can dedupe onto a consumer's later copy.
 * A spec is safe only when at least one alternative is an open range.
 */
export function isExactPin(spec) {
  if (typeof spec !== 'string') return false
  const alternatives = spec
    .split('||')
    .map((alternative) => alternative.trim())
    .filter((alternative) => alternative.length > 0)
  if (alternatives.length === 0) return false
  return alternatives.every((alternative) => EXACT_VERSION.test(alternative))
}

/**
 * Return one `section.name = spec` line for every first-party exact pin.
 * An empty array means the manifest is publishable under this policy.
 */
export function exactFirstPartyPins(manifest) {
  const offenders = []
  for (const section of CHECKED_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest?.[section] ?? {})) {
      if (!name.startsWith(FIRST_PARTY_SCOPE)) continue
      if (isExactPin(spec)) offenders.push(`${section}.${name} = ${spec}`)
    }
  }
  return offenders
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const offenders = exactFirstPartyPins(manifest)
  if (offenders.length > 0) {
    process.stderr.write(
      `${manifest.name} publishes exact first-party version pins, which duplicate the package for every consumer already holding a later one:\n${offenders
        .map((entry) => `  ${entry}`)
        .join('\n')}\nDeclare a range instead: a caret from 1.0.0, or ">=X.Y.Z <X.Y+1.0" below it.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`${manifest.name}@${manifest.version} declares first-party ranges only\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
