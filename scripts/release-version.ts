import packageInfo from "../package.json";

/** Release channels, from least to most stable. */
export type ReleaseChannel = "alpha" | "beta" | "rc" | "stable";

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

/** The channel a package version belongs to, e.g. "1.0.0-beta.0" → "beta". */
export function releaseChannel(packageVersion: string): ReleaseChannel {
  const match = VERSION.exec(packageVersion);
  if (!match)
    throw new Error(
      "Package version must be a release such as 1.0.0, or a prerelease such as 1.0.0-beta.0 (alpha, beta or rc).",
    );
  return (match[4] as ReleaseChannel | undefined) ?? "stable";
}

/**
 * The version a CI build is published as.
 *
 * - With a version tag (`v` + package version) the build is that exact
 *   release, so the ZIP manifest and the tag always agree.
 * - Without one it is a snapshot that sorts after the package version:
 *   `1.0.0-beta.0` builds become `1.0.0-beta.<run>.g<sha>`, and stable
 *   `1.0.0` builds become `1.0.0-build.<run>.g<sha>`.
 */
export function releaseVersion(
  packageVersion: string,
  runNumber: string,
  commitSha: string,
  versionTag = "",
): string {
  const channel = releaseChannel(packageVersion);
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
  const label = channel === "stable" ? "build" : channel;
  return `${baseVersion}-${label}.${runNumber}.g${commitSha.slice(0, 7)}`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "channel") {
    // `bun run scripts/release-version.ts channel [version]`
    console.info(releaseChannel(args[1] || packageInfo.version));
  } else {
    const [runNumber = "", commitSha = "", versionTag = ""] = args;
    console.info(
      releaseVersion(packageInfo.version, runNumber, commitSha, versionTag),
    );
  }
}
