import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signInAction } from "@/platform/auth/actions";
import { AuthStatus } from "../auth-status";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string }>;
}) {
  const t = await getTranslations();
  const { status } = await searchParams;

  return (
    <main className="auth-screen">
      <form action={signInAction} className="auth-card">
        <h1 className="auth-heading">{t("signin")}</h1>
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
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="auth-submit">
          {t("signin")}
        </button>
        <p className="auth-alt">
          <Link href="/sign-up">{t("signup")}</Link>
        </p>
      </form>
    </main>
  );
}
