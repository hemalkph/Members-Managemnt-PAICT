const PAGE = 1000; // the API returns at most 1,000 rows per request

/**
 * Every row of a query, fetched 1,000 at a time. `page(from, to)` must build
 * the same ordered query each time and end with `.range(from, to)`.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
