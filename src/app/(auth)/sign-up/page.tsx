import Link from "next/link";
import { LinkPending } from "@/platform/ui/link-pending";
import { getTranslations } from "next-intl/server";
import { signUpAction } from "@/platform/auth/actions";
import { SubmitButton } from "@/platform/ui/submit-button";
import { AuthStatus } from "../auth-status";

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string }>;
}) {
  const t = await getTranslations();
  const { status } = await searchParams;

  return (
    <main className="auth-screen">
      <form action={signUpAction} className="auth-card">
        <h1 className="auth-heading">{t("signup")}</h1>
        <p className="auth-sub">{t("signinSub")}</p>
        <AuthStatus status={status} />
        <label className="auth-field">
          {t("email")}
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="auth-field">
          {t("password")}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        <SubmitButton className="auth-submit">
          {t("signup")}
        </SubmitButton>
        <p className="auth-alt">
          <Link href="/sign-in">
            {t("signin")}
            <LinkPending />
          </Link>
        </p>
      </form>
    </main>
  );
}
