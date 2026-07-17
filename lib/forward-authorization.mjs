import { readFile, stat } from "node:fs/promises";

const AUTHORIZATION_PATTERN = /^(?:Basic|Bearer) [A-Za-z0-9._~+\/-]+=*$/u;

export const loadForwardAuthorization = async (authorizationFile) => {
  if (!authorizationFile) {
    throw new Error(
      "Missing FORWARD_AUTHORIZATION_FILE or connector config forwardAuthorizationFile.",
    );
  }
  const metadata = await stat(authorizationFile);
  if (!metadata.isFile()) {
    throw new Error("Forward authorization path must be a regular file.");
  }
  if ((metadata.mode & 0o027) !== 0) {
    throw new Error(
      "Forward authorization file must not be writable by group or accessible by other users.",
    );
  }
  const authorization = (await readFile(authorizationFile, "utf8")).trim();
  if (
    authorization.length < 16 ||
    authorization.length > 8192 ||
    !AUTHORIZATION_PATTERN.test(authorization)
  ) {
    throw new Error(
      "Forward authorization file must contain exactly one valid Basic or Bearer Authorization value.",
    );
  }
  return authorization;
};
