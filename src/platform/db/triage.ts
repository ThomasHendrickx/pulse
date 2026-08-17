import { setTimeout as delay } from "node:timers/promises";
import { resolve4 } from "node:dns/promises";
import { createConnection } from "node:net";

// Connectivity triage for the deployed P1001 (deploy-verify round 6). Two
// hypotheses need separating: Supabase network restrictions dropping
// Vercel's connections, versus a wrong pooler host in the env. The probes
// here disclose NOTHING derived from env values beyond booleans:
//   - The candidate hosts below are HARDCODED public shared Supabase
//     pooler infrastructure; probing them involves no env reading at all.
//   - For an env connection string, only boolean facts leave the server
//     (is the host one of the known candidates, is the port a pooler port,
//     does the host end in a Supabase domain, does it resolve to IPv4,
//     plus present/parseable so an absent variable is not mistaken for a
//     wrong host). Never a hostname, port number, or any substring of the
//     value. This is the constraint that got the round-4 target field
//     flagged; it is respected strictly here by construction: the boolean
//     derivation returns a fixed-shape object of booleans only.

export const POOLER_CANDIDATE_HOSTS = [
  "aws-0-eu-central-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
] as const;

export const POOLER_CANDIDATE_PORTS = [6543, 5432] as const;

export type TcpProbeResult = "reachable" | "timeout" | string;

// Plain TCP connect, destroyed immediately on success. Resolves with
// "reachable", "timeout", or the socket error code; never rejects.
export const tcpProbe = (
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpProbeResult> =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const settle = (result: TcpProbeResult): void => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle("reachable"));
    socket.once("timeout", () => settle("timeout"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      settle(typeof error.code === "string" ? error.code : error.name),
    );
  });

// The four hardcoded candidate probes, concurrent.
export const probeCandidates = async (
  timeoutMs: number,
): Promise<Record<string, TcpProbeResult>> => {
  const targets = POOLER_CANDIDATE_HOSTS.flatMap((host) =>
    POOLER_CANDIDATE_PORTS.map((port) => ({ host, port })),
  );
  const results = await Promise.all(
    targets.map(async ({ host, port }) => ({
      key: `${host}:${port}`,
      result: await tcpProbe(host, port, timeoutMs),
    })),
  );
  return Object.fromEntries(results.map(({ key, result }) => [key, result]));
};

// Boolean-only introspection of an env connection string. The sync half is
// pure and unit-tested; nothing of the input reaches the output, which is
// a fixed-shape object of booleans.
export type EnvUrlBooleans = {
  readonly present: boolean;
  readonly parseable: boolean;
  readonly hostIsKnownPoolerCandidate: boolean;
  readonly portIsPooler: boolean;
  readonly hostEndsWithSupabaseDomain: boolean;
};

export const envUrlBooleans = (value: string | undefined): EnvUrlBooleans => {
  const allFalse = {
    present: false,
    parseable: false,
    hostIsKnownPoolerCandidate: false,
    portIsPooler: false,
    hostEndsWithSupabaseDomain: false,
  };
  if (value === undefined || value === "") {
    return allFalse;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ...allFalse, present: true };
  }
  const hostname = url.hostname.toLowerCase();
  // A postgres URL without an explicit port dials 5432, so the default
  // counts as a pooler-capable port here.
  const port = url.port === "" ? 5432 : Number(url.port);
  return {
    present: true,
    parseable: true,
    hostIsKnownPoolerCandidate: (POOLER_CANDIDATE_HOSTS as readonly string[]).includes(
      hostname,
    ),
    portIsPooler: port === 6543 || port === 5432,
    hostEndsWithSupabaseDomain:
      hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co"),
  };
};

// DNS half, async: does the env URL's host resolve to at least one IPv4
// address? Returns a boolean only; the hostname never leaves this module.
export const envHostHasIpv4 = async (
  value: string | undefined,
  timeoutMs: number,
): Promise<boolean> => {
  if (value === undefined || value === "") {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }
  try {
    const records = await Promise.race([
      resolve4(hostname),
      delay(timeoutMs).then(() => "timeout" as const),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
};
