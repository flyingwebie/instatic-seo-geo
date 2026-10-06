import packageInfo from '../package.json'

export function alphaReleaseVersion(runNumber: string, commitSha: string): string {
  const sequence = Number(runNumber)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== runNumber) {
    throw new Error('Release run number must be a positive integer without leading zeros.')
  }
  if (commitSha.length !== 40 || !/^[a-f0-9]+$/.test(commitSha)) {
    throw new Error('Release commit must be a full lowercase Git SHA.')
  }

  const baseVersion = packageInfo.version.split('-')[0]
  return `${baseVersion}-alpha.${runNumber}.g${commitSha.slice(0, 7)}`
}

if (import.meta.main) {
  const [runNumber = '', commitSha = ''] = process.argv.slice(2)
  console.info(alphaReleaseVersion(runNumber, commitSha))
}
