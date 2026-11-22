import type { Static, TSchema } from "@sinclair/typebox";
import type { usePluginRoutes } from "@instatic/host-hooks";
import { validate } from "../src/config";

type Routes = ReturnType<typeof usePluginRoutes>;

/**
 * Call one of this plugin's server routes and return its validated answer.
 *
 * The host's own JSON helper reports every failure as "Plugin route failed
 * with 400" and drops the reason the server sent, so a missing credential and
 * a broken page read the same. This reads the server's `error` text instead,
 * which is written for the person looking at the page.
 */
export async function callRoute<T extends TSchema>(
  routes: Routes,
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<Static<T>> {
  const response = await routes.fetch(path, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const reason =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "";
    throw new Error(
      reason ||
        `The server could not complete the request (HTTP ${response.status}). Reload the page and try again.`,
    );
  }
  return validate(schema, body, "response");
}
