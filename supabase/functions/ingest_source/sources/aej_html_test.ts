import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { fetchAejItems } from "./aej_html.ts";

const originalFetch = globalThis.fetch;

function inertiaHtml(payload: Record<string, unknown>) {
  const escaped = JSON.stringify(payload).replace(/"/g, "&quot;");
  return `<html><body><div id="app" data-page="${escaped}"></div></body></html>`;
}

function listPageHtml(params: {
  page: number;
  lastPage: number;
  total: number;
  offers: Array<Record<string, unknown>>;
}) {
  return inertiaHtml({
    component: "OffresEmploi",
    props: {
      offres: {
        data: params.offers,
        total: params.total,
        last_page: params.lastPage,
        current_page: params.page,
        next_page_url: params.page < params.lastPage
          ? `https://agenceemploijeunes.ci/offres-emploi?show_all=1&page=${
            params.page + 1
          }`
          : null,
      },
    },
  });
}

function detailPageHtml(params: {
  reference: string;
  title: string;
  company: string;
}) {
  return inertiaHtml({
    component: "OffresEmploi/Show",
    props: {
      offre: {
        reference: params.reference,
        slug: params.reference,
        titre: params.title,
        entreprise: params.company,
        localisation: "ABIDJAN",
        type_contrat: "Stage",
        date_publication: "2026-07-30",
        date_fin: "2026-08-30",
        description: "Description test",
      },
    },
  });
}

function listOffer(reference: string, title: string) {
  return {
    id: reference,
    reference,
    slug: reference,
    titre: title,
    localisation: "ABIDJAN",
    date_publication: "2026-07-30",
    date_fin: "2026-08-30",
  };
}

Deno.test("AEJ fetch retries transient list failures before parsing", async () => {
  let listCalls = 0;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("/offres-emploi?show_all=1")) {
      listCalls++;
      if (listCalls === 1) {
        return Promise.resolve(new Response("temporary", { status: 502 }));
      }
      return Promise.resolve(
        new Response(
          listPageHtml({
            page: 1,
            lastPage: 1,
            total: 1,
            offers: [listOffer("ABID-177900-07-2026", "STAGIAIRE TEST")],
          }),
          { headers: { "content-type": "text/html; charset=UTF-8" } },
        ),
      );
    }
    if (url.includes("/offres-emploi/ABID-177900-07-2026")) {
      return Promise.resolve(
        new Response(
          detailPageHtml({
            reference: "ABID-177900-07-2026",
            title: "STAGIAIRE TEST",
            company: "ENTREPRISE TEST",
          }),
          { headers: { "content-type": "text/html; charset=UTF-8" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;

  try {
    const result = await fetchAejItems(null, 1, 10, 0, 1);
    assertEquals(result.ok, true);
    assertEquals(result.parsed, 1);
    assertEquals(result.meta.interrupted, false);
    assertEquals(result.meta.diagnostics[0].attempt_count, 2);
    assertEquals(result.items[0].company_name, "ENTREPRISE TEST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("AEJ fetch marks a later failed page as partial instead of healthy", async () => {
  globalThis.fetch = ((input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("page=2")) {
      return Promise.resolve(new Response("temporary", { status: 502 }));
    }
    if (url.includes("/offres-emploi?show_all=1")) {
      return Promise.resolve(
        new Response(
          listPageHtml({
            page: 1,
            lastPage: 2,
            total: 2,
            offers: [listOffer("ABID-177901-07-2026", "COMMERCIAL TEST")],
          }),
          { headers: { "content-type": "text/html; charset=UTF-8" } },
        ),
      );
    }
    if (url.includes("/offres-emploi/ABID-177901-07-2026")) {
      return Promise.resolve(
        new Response(
          detailPageHtml({
            reference: "ABID-177901-07-2026",
            title: "COMMERCIAL TEST",
            company: "SOCIETE TEST",
          }),
          { headers: { "content-type": "text/html; charset=UTF-8" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;

  try {
    const result = await fetchAejItems(null, 2, 10, 0, 1);
    assertEquals(result.ok, false);
    assertEquals(result.parsed, 1);
    assertEquals(result.stopped_reason, "partial_page_not_ok");
    assertEquals(result.meta.interrupted, true);
    assertEquals(result.meta.list_fetch_error_count, 1);
    assertEquals(result.meta.diagnostics[1].attempt_count, 3);
    assert(result.warnings.includes("aej_list_page_fetch_failed_after_partial_results"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
