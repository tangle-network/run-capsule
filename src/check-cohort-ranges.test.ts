import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain node script, no type declarations
import { exactFirstPartyPins, isExactPin } from '../scripts/check-cohort-ranges.mjs'

describe('isExactPin', () => {
  it.each([
    '1.2.3',
    'v1.2.3',
    '=1.2.3',
    '= 1.2.3',
    '  1.2.3  ',
    '1.2.3-rc.1',
    '1.2.3+build.5',
    '1.2.3 || 1.2.4',
  ])('refuses %s, which names a closed set of versions', (spec) => {
    expect(isExactPin(spec)).toBe(true)
  })

  it.each([
    '^1.0.0',
    '~1.2.0',
    '>=0.147.0 <0.148.0',
    '>1.2.3',
    '1.0.x',
    '1.x',
    '*',
    'latest',
    'workspace:*',
    'npm:@tangle-network/other@^1.0.0',
    '1.2.3 || ^2.0.0',
  ])('accepts %s, which admits more than a closed set', (spec) => {
    expect(isExactPin(spec)).toBe(false)
  })

  it('accepts a non-string spec, which the manifest reader never produces as a range', () => {
    expect(isExactPin(undefined as unknown as string)).toBe(false)
  })
})

describe('exactFirstPartyPins', () => {
  it('reports one line per offending section and name', () => {
    expect(
      exactFirstPartyPins({
        dependencies: { '@tangle-network/agent-eval': '0.147.0' },
        devDependencies: { '@tangle-network/ui': '=11.5.0' },
        peerDependencies: { '@tangle-network/brand': '^1.5.0' },
      }),
    ).toEqual([
      'dependencies.@tangle-network/agent-eval = 0.147.0',
      'devDependencies.@tangle-network/ui = =11.5.0',
    ])
  })

  it('ignores third-party exact pins, which cannot duplicate a first-party class identity', () => {
    expect(exactFirstPartyPins({ dependencies: { playwright: '1.57.0' } })).toEqual([])
  })

  it('reports nothing for a manifest with no checked sections', () => {
    expect(exactFirstPartyPins({})).toEqual([])
  })

  it('passes this package own manifest, the gate the publish path runs', async () => {
    const manifest = JSON.parse(
      await import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
      ),
    )
    expect(exactFirstPartyPins(manifest)).toEqual([])
  })
})
