import { describe, expect, test } from 'bun:test'
import { alphaReleaseVersion } from '../scripts/release-version'

const commitSha = 'abcdef0123456789abcdef0123456789abcdef01'

describe('alpha release identity', () => {
  test('includes the release sequence and source commit in a prerelease version', () => {
    expect(alphaReleaseVersion('42', commitSha)).toBe('0.2.0-alpha.42.gabcdef0')
  })

  test('keeps retries stable and separate runs distinct', () => {
    expect(alphaReleaseVersion('42', commitSha)).toBe(alphaReleaseVersion('42', commitSha))
    expect(alphaReleaseVersion('42', commitSha)).not.toBe(alphaReleaseVersion('43', commitSha))
  })

  test('rejects malformed workflow identifiers before they become release names', () => {
    for (const runNumber of ['', '0', '01', '-1', '1.5', '1e3', '42\n', '42\nextra', '9007199254740992']) {
      expect(() => alphaReleaseVersion(runNumber, commitSha)).toThrow('run number')
    }
    for (const sha of ['', 'abcdef0', commitSha.toUpperCase(), `${commitSha}\n`, `${commitSha}\nextra`]) {
      expect(() => alphaReleaseVersion('42', sha)).toThrow('Git SHA')
    }
  })
})
