// Server-side diagnostics for the auth boundary (deploy-verify round for
// criterion 0.6). These lines exist to be read in the Vercel function logs
// when a deployed sign-up fails invisibly. Never log connection strings,
// passwords or environment values; the email is deliberately included (a
// single-household app, server logs only).

type FailureDetails = {
  readonly name: string;
  readonly code: string | undefined;
  readonly message: string;
};

const detailsOf = (cause: unknown): FailureDetails => {
  if (cause instanceof Error) {
    const code =
      "code" in cause && typeof (cause as { code?: unknown }).code === "string"
        ? (cause as { code: string }).code
        : undefined;
    return { name: cause.name, code, message: cause.message };
  }
  return { name: "non-error", code: undefined, message: String(cause) };
};

export const logAuthFailure = (
  step: string,
  email: string,
  cause: unknown,
): void => {
  const { name, code, message } = detailsOf(cause);
  console.error(
    `[pulse:auth] ${step} failed for ${email}: name=${name} code=${code ?? "none"} message=${message}`,
  );
};
