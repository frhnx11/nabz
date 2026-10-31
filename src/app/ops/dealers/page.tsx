import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, LoadingCards, PageHeader, Panel } from "@/components/ui";
import { db } from "@/lib/db/client";
import { listDealers, DEALERS_PAGE_SIZE } from "@/lib/db/queries/dealers";
import { maskPhone } from "@/lib/domain/phone";
import { languageName } from "@/lib/reference/languages";
import { getSector, vocabLabel } from "@/lib/sectors/registry";
import { AddDealer } from "./add-dealer";
import { type DealerRow, DealerTable } from "./dealer-table";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Dealers" };

type SearchParams = PageProps<"/ops/dealers">["searchParams"];

export default function DealersPage({ searchParams }: PageProps<"/ops/dealers">) {
  return (
    <>
      <PageHeader title="Dealers" action={<AddDealer />} />
      <Suspense fallback={<LoadingCards rows={8} />}>
        <DealerList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DealerList({ searchParams }: { searchParams: SearchParams }) {
  await io();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const requested = Number(params.page);
  const database = db();

  let page = Number.isInteger(requested) && requested >= 1 ? requested : 1;
  let { rows, total } = await listDealers(database, { query, page });
  const pages = Math.max(1, Math.ceil(total / DEALERS_PAGE_SIZE));
  if (page > pages) {
    page = 1;
    ({ rows, total } = await listDealers(database, { query, page }));
  }
  const vehicles = getSector("vehicles");
  // Display text only: the full number never reaches the browser here (the edit pop-up loads it).
  const display: DealerRow[] = rows.map((r) => ({
    id: r.id,
    businessName: r.businessName,
    contactName: r.contactName,
    brand: vocabLabel(vehicles, "brand", r.attributes.brand ?? ""),
    city: r.city,
    state: r.state,
    phone: maskPhone(r.phoneE164),
    language: languageName(r.language),
  }));
  const pageHref = (p: number) => ({
    pathname: "/ops/dealers" as const,
    query: { ...(query ? { q: query } : {}), page: p },
  });

  return (
    <>
      <SearchBox initialQuery={query} total={total} />

      <Panel flush>
        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-faint">
            {query ? `No dealers match “${query}”.` : "No dealers yet. Add the first dealer above."}
          </p>
        ) : (
          <DealerTable rows={display} />
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
            <span className="text-muted">
              Page <span className="num">{page}</span> of <span className="num">{pages}</span>
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={pageHref(page + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
