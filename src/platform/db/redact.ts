// Redaction for error text crossing a disclosure boundary (the db health
// probe, deploy-verify round 3). Prisma and driver errors can embed the
// database host, port or a full URL in their message (P1001 quotes the
// target in backticks, node network errors print ip:port); nothing that
// could be part of a connection string may leave the server. Redaction is
// deliberately broad: backtick-quoted spans are dropped wholesale, which
// can also hide a constraint name, and that loss is accepted at this
// boundary. Residue, stated: a bare unquoted hostname without port or
// scheme inside prose would survive these patterns; no known Prisma or
// pg-driver message has that shape today.

export const redactConnectionTargets = (message: string): string =>
  message
    .replace(/postgres(ql)?:\/\/\S+/gi, "<redacted-url>")
    .replace(/`[^`]*`/g, "<redacted>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/g, "<redacted-address>");
