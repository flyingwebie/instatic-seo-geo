import { describe, expect, test } from "bun:test";
import { releaseVersion } from "../scripts/release-version";

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

  test("keeps stable, malformed and non-alpha package versions out of alpha releases", () => {
    for (const version of [
      "",
      "0.3.0",
      "0.3.0-beta.0",
      "latest",
      "01.3.0-alpha.0",
      "0.3.0-alpha.01",
      "0.3.0-alpha.0\n",
    ]) {
      expect(() => releaseVersion(version, "42", commitSha)).toThrow(
        "alpha prerelease",
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
