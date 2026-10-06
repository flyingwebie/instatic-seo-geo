import packageInfo from "../package.json";

export function releaseVersion(
  packageVersion: string,
  runNumber: string,
  commitSha: string,
  versionTag = "",
): string {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)(?:\.g[a-f0-9]+)?$/.test(
      packageVersion,
    )
  ) {
    throw new Error(
      "Package version must be an alpha prerelease such as 0.3.1-alpha.0.",
    );
  }
  const sequence = Number(runNumber);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    String(sequence) !== runNumber
  ) {
    throw new Error(
      "Release run number must be a positive integer without leading zeros.",
    );
  }
  if (commitSha.length !== 40 || !/^[a-f0-9]+$/.test(commitSha)) {
    throw new Error("Release commit must be a full lowercase Git SHA.");
  }

  if (versionTag) {
    if (versionTag !== `v${packageVersion}`) {
      throw new Error(
        "Version tag must exactly match the package version prefixed with v.",
      );
    }
    return packageVersion;
  }

  const baseVersion = packageVersion.split("-")[0];
  return `${baseVersion}-alpha.${runNumber}.g${commitSha.slice(0, 7)}`;
}

if (import.meta.main) {
  const [runNumber = "", commitSha = "", versionTag = ""] =
    process.argv.slice(2);
  console.info(
    releaseVersion(packageInfo.version, runNumber, commitSha, versionTag),
  );
}
