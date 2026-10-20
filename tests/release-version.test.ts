import { describe, expect, test } from "bun:test";
import { releaseChannel, releaseVersion } from "../scripts/release-version";

const commitSha = "abcdef0123456789abcdef0123456789abcdef01";

const packageVersion = "0.3.0-alpha.0";

describe("release identity", () => {
  test("includes the release sequence and source commit in a prerelease version", () => {
    expect(releaseVersion(packageVersion, "42", commitSha)).toBe(
      "0.3.0-alpha.42.gabcdef0",
    );
    expect(releaseVersion("0.3.1-alpha.0", "42", commitSha)).toBe(
      "0.3.1-alpha.42.gabcdef0",
    );
  });

  test("keeps retries stable and separate runs distinct", () => {
    expect(releaseVersion(packageVersion, "42", commitSha)).toBe(
      releaseVersion(packageVersion, "42", commitSha),
    );
    expect(releaseVersion(packageVersion, "42", commitSha)).not.toBe(
      releaseVersion(packageVersion, "43", commitSha),
    );
  });

  test("version tags keep the exact package version across workflow runs", () => {
    const version = "0.3.1-alpha.0";
    expect(releaseVersion(version, "42", commitSha, `v${version}`)).toBe(
      version,
    );
    expect(releaseVersion(version, "43", commitSha, `v${version}`)).toBe(
      version,
    );
  });

  test("rejects tags that would disagree with the ZIP manifest version", () => {
    for (const tag of [
      "0.3.0-alpha.0",
      "v0.3.1-alpha.0",
      "v0.3.0",
      "v0.3.0-alpha.1",
      "v0.3.0-alpha.0\n",
    ]) {
      expect(() =>
        releaseVersion(packageVersion, "42", commitSha, tag),
      ).toThrow("match the package version");
    }
  });

  test("beta, release-candidate and stable versions get matching snapshots", () => {
    expect(releaseVersion("1.0.0-beta.0", "57", commitSha)).toBe(
      "1.0.0-beta.57.gabcdef0",
    );
    expect(releaseVersion("1.0.0-rc.2", "57", commitSha)).toBe(
      "1.0.0-rc.57.gabcdef0",
    );
    expect(releaseVersion("1.0.0", "57", commitSha)).toBe(
      "1.0.0-build.57.gabcdef0",
    );
    expect(
      releaseVersion("1.0.0-beta.0", "57", commitSha, "v1.0.0-beta.0"),
    ).toBe("1.0.0-beta.0");
    expect(releaseVersion("1.0.0", "57", commitSha, "v1.0.0")).toBe("1.0.0");
  });

  test("reports the release channel of a package version", () => {
    expect(releaseChannel("0.3.0-alpha.0")).toBe("alpha");
    expect(releaseChannel("1.0.0-beta.0")).toBe("beta");
    expect(releaseChannel("1.0.0-rc.1")).toBe("rc");
    expect(releaseChannel("1.0.0")).toBe("stable");
  });

  test("rejects malformed package versions and unknown channels", () => {
    for (const version of [
      "",
      "latest",
      "1.0",
      "1.0.0-preview.0",
      "1.0.0-beta",
      "01.3.0-alpha.0",
      "0.3.0-alpha.01",
      "0.3.0-alpha.0\n",
      "0.3.0-alpha.0.gabc1234",
    ]) {
      expect(() => releaseVersion(version, "42", commitSha)).toThrow(
        "Package version must be",
      );
    }
  });

  test("rejects malformed workflow identifiers before they become release names", () => {
    for (const runNumber of [
      "",
      "0",
      "01",
      "-1",
      "1.5",
      "1e3",
      "42\n",
      "42\nextra",
      "9007199254740992",
    ]) {
      expect(() =>
        releaseVersion(packageVersion, runNumber, commitSha),
      ).toThrow("run number");
    }
    for (const sha of [
      "",
      "abcdef0",
      commitSha.toUpperCase(),
      `${commitSha}\n`,
      `${commitSha}\nextra`,
    ]) {
      expect(() => releaseVersion(packageVersion, "42", sha)).toThrow(
        "Git SHA",
      );
    }
  });
});
