import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Language order everywhere: English, Dutch, French. English is the source,
// the other two are translations. URL paths stay English; the locale rides a
// cookie, defaulting to English.

export const locales = ["en", "nl", "fr"] as const;
export type Locale = (typeof locales)[number];

const defaultLocale: Locale = "en";

const parseLocale = (candidate: string | undefined): Locale => {
  if (candidate !== undefined && (locales as readonly string[]).includes(candidate)) {
    return candidate as Locale;
  }
  return defaultLocale;
};

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = parseLocale(store.get("locale")?.value);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
