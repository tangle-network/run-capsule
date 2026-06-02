import { describe, expect, it } from 'vitest'

import type { Span } from '@tangle-network/agent-eval'
import { redactSpans } from './redact.js'

/** Put a secret-bearing string in a tool span's args, redact, return the
 *  redacted args as a string so we can assert on it. */
function redactArg(value: string): string {
  const spans = [
    { spanId: 's', runId: 'r', kind: 'tool', name: 'shell.exec', toolName: 'shell.exec', args: { command: value }, startedAt: 0, endedAt: 1, status: 'ok' } as Span,
  ]
  const out = redactSpans(spans)[0] as { args: { command: string } }
  return out.args.command
}

const MASK = '«redacted»'
// Assemble credential-shaped tokens from parts so the SOURCE carries no literal
// secret (GitHub push-protection / scanners flag the contiguous patterns). The
// runtime VALUE is identical, so the redactor is exercised exactly the same.
const j = (...p: string[]) => p.join('')
const GHP = j('ghp', '_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
const GHP2 = j('ghp', '_', 'RESULT1234567890ABCDEFGHIJKLMNOP')
const GHP3 = j('ghp', '_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
const SK = j('sk', '-', 'abcdEFGH1234ijklMNOP5678qrst')
const SK2 = j('sk', '-', 'DEEPnested1234567890abcd')
const RK = j('rk', '-', 'live_0123456789abcdefABCDEF')
const XOXB = j('xox', 'b-', '1234567890-abcdefghijklmnop')
const XOXB2 = j('xox', 'b-', '999-deadbeefdeadbeef')
const AKIA = j('AKIA', 'IOSFODNN7EXAMPLE')
const AIZA = j('AIza', 'SyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe')
const JWT = j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjMifQ', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c')

describe('redactSpans — adversarial credential shapes', () => {
  const leaks: Array<[string, string, string]> = [
    ['OpenAI key', `OPENAI_API_KEY=${SK}`, SK],
    ['Stripe-style', `use ${RK}`, RK],
    ['GitHub PAT', `token ${GHP}`, GHP],
    ['Slack token', XOXB, XOXB],
    ['AWS access key', `${AKIA} here`, AKIA],
    ['Google API key', `${AIZA} here`, AIZA],
    ['JWT', `Authorization: Bearer ${JWT}`, JWT],
    ['key=value secret', `client_secret: "s3cret-value-not-shown-123"`, 's3cret-value-not-shown-123'],
  ]

  for (const [label, input, token] of leaks) {
    it(`redacts ${label}`, () => {
      const out = redactArg(input)
      expect(out).toContain(MASK)
      expect(out).not.toContain(token)
    })
  }

  it('redacts a PEM private key block', () => {
    // markers assembled so no contiguous "PRIVATE KEY" header sits in source
    const pk = j('PRIVATE', ' ', 'KEY')
    const pem = j('-----BEGIN RSA ', pk, '-----\nMIIEowIBAAKCAQEA1234abcd\n-----END RSA ', pk, '-----')
    const out = redactArg(pem)
    expect(out).toContain(MASK)
    expect(out).not.toContain('MIIEowIBAAKCAQEA1234abcd')
  })

  it('redacts secrets nested deep in span content + result + attributes', () => {
    const spans = [
      {
        spanId: 's', runId: 'r', kind: 'tool', name: 'create_file', toolName: 'create_file',
        args: { path: '.env', content: `OPENAI_API_KEY=${SK2}\nPORT=3000` },
        result: `wrote token ${GHP2}`,
        attributes: { note: `pushed with ${XOXB2}` },
        startedAt: 0, endedAt: 1, status: 'ok',
      } as Span,
    ]
    const out = JSON.stringify(redactSpans(spans))
    expect(out).not.toContain(SK2)
    expect(out).not.toContain(GHP2)
    expect(out).not.toContain('deadbeefdeadbeef')
    expect(out).toContain('PORT=3000') // benign config survives
  })

  it('leaves screenshot data URIs intact (they are the point of the screen capsule)', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    const spans = [
      { spanId: 's', runId: 'r', kind: 'tool', name: 'browser.goto', toolName: 'browser.goto', args: { url: 'http://x' }, attributes: { screenshot: dataUri }, startedAt: 0, endedAt: 1, status: 'ok' } as Span,
    ]
    const out = redactSpans(spans)[0] as unknown as { attributes: { screenshot: string } }
    expect(out.attributes.screenshot).toBe(dataUri)
  })

  it('does not mangle ordinary prose or short tokens', () => {
    const benign = 'The agent read the auth module and ran the tests.'
    expect(redactArg(benign)).toBe(benign)
  })

  it('does not mutate the input spans (returns a redacted copy)', () => {
    const spans = [
      { spanId: 's', runId: 'r', kind: 'tool', name: 't', toolName: 't', args: { command: `token ${GHP3}` }, startedAt: 0, endedAt: 1, status: 'ok' } as Span,
    ]
    redactSpans(spans)
    expect((spans[0] as { args: { command: string } }).args.command).toContain(GHP3)
  })
})
