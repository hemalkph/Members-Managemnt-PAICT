import "server-only";

import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, parseLang, type Lang, type T } from "./index";

/** The signed-in person's dispatch language (saved on their device). */
export async function getDispatchLang(): Promise<Lang> {
  const store = await cookies();
  return parseLang(store.get(LANG_COOKIE)?.value);
}

/** For server pages and Server Actions. */
export async function getT(): Promise<T> {
  return makeT(await getDispatchLang());
}
