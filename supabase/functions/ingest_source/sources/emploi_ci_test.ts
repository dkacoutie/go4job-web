import {
  EmploiCiFetchError,
  fetchEmploiCiItems,
  parseEmploiCiOffersFromHtml,
} from "./emploi_ci.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function card(params: {
  id: number;
  slug: string;
  title: string;
  company: string;
  location?: string;
  duplicateButton?: boolean;
}) {
  const url =
    `https://emploi.educarriere.ci/offre-${params.id}-${params.slug}.html`;
  return `
    <div class="ej-card">
      <div class="ej-card-inner">
        <img src="/logo.png" alt="${params.company}" class="ej-logo">
        <div class="ej-content">
          <a href="${url}" class="ej-poste">${params.title}</a>
          <div class="ej-societe"><i></i> ${params.company}</div>
          <div class="ej-meta">
            <span class="ej-lieu"><i></i> ${
    params.location ?? "Abidjan"
  }</span>
            <span class="ej-tag ej-tag-other">Emploi</span>
            <span class="ej-lieu"><i></i> Publie le 29/07/2026</span>
          </div>
        </div>
      </div>
      <div class="ej-card-foot">
        <div class="ej-expire"><i></i> Expire le 10/08/2026</div>
        ${
    params.duplicateButton
      ? `<a href="${url}" class="ej-btn">Voir+</a>`
      : ""
  }
      </div>
    </div>`;
}

function pageHtml(params: {
  page?: number;
  maxPages?: number;
  displayedCount?: number;
  cards?: string;
}) {
  const page = params.page ?? 1;
  const maxPages = params.maxPages ?? 1;
  const displayedCount = params.displayedCount ?? 1;
  return `<!doctype html>
    <html>
      <body>
        <a href="/index.php/emploi-accueil">Emploi accueil</a>
        <section id="ec-quicksearch">
          <h2>Trouvez votre prochain emploi</h2>
          <strong id="ec-hero-count">${displayedCount}</strong>
          <span id="ec-hero-label">offres en ligne</span>
        </section>
        <h2>Offres a la Une</h2>
        <script>function changePage(pageNum) { return pageNum; }</script>
        <span>Page ${page} sur ${maxPages}</span>
        ${params.cards ?? ""}
      </body>
    </html>`;
}

Deno.test("Educarriere parser extracts a normal page with title, company, location, dates and source URL", () => {
  const parsed = parseEmploiCiOffersFromHtml(pageHtml({
    cards: card({
      id: 153146,
      slug: "ressources-humaines",
      title: "RESSOURCES HUMAINES",
      company: "VISIONNAIRE GROUPE ENTREPRISE SARL",
      location: "Bouake",
    }),
  }));

  assertEquals(parsed.items.length, 1, "one offer should be parsed");
  assertEquals(parsed.items[0].external_id, "educarriere:153146", "external id");
  assertEquals(parsed.items[0].title, "RESSOURCES HUMAINES", "title");
  assertEquals(
    parsed.items[0].company_name,
    "VISIONNAIRE GROUPE ENTREPRISE SARL",
    "company",
  );
  assertEquals(parsed.items[0].location, "Bouake", "location");
  assertEquals(
    parsed.items[0].source_url,
    "https://emploi.educarriere.ci/offre-153146-ressources-humaines.html",
    "source URL",
  );
  assert(parsed.items[0].published_at?.startsWith("2026-07-29"), "published date");
  assert(parsed.items[0].expires_at?.startsWith("2026-08-10"), "expiry date");
});

Deno.test("Educarriere parser handles multiple offers", () => {
  const parsed = parseEmploiCiOffersFromHtml(pageHtml({
    displayedCount: 2,
    cards: card({
      id: 1,
      slug: "comptable",
      title: "Comptable",
      company: "A",
    }) + card({
      id: 2,
      slug: "developpeur",
      title: "Developpeur",
      company: "B",
    }),
  }));

  assertEquals(parsed.items.length, 2, "two offers should be parsed");
  assertEquals(parsed.items[1].external_id, "educarriere:2", "second id");
});

Deno.test("Educarriere parser deduplicates repeated links for the same offer id", () => {
  const parsed = parseEmploiCiOffersFromHtml(pageHtml({
    cards: card({
      id: 153145,
      slug: "call-center",
      title: "05 CONSEILLERS CLIENTS",
      company: "LERIE DIET",
      duplicateButton: true,
    }),
  }));

  assertEquals(parsed.raw_link_count, 2, "raw links include title and button");
  assertEquals(parsed.unique_link_id_count, 1, "unique offer ids");
  assertEquals(parsed.items.length, 1, "deduplicated offer count");
});

Deno.test("Educarriere fetch rejects HTTP 200 PHP error pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        `Erreur: Le fichier "/var/www/controllers/nos_offres.php" n'existe pas`,
        { status: 200 },
      ),
    )) as typeof fetch;
  try {
    let error: unknown = null;
    try {
      await fetchEmploiCiItems(10, { maxPages: 1 });
    } catch (err) {
      error = err;
    }
    assert(error instanceof EmploiCiFetchError, "should throw typed error");
    assertEquals(
      (error as EmploiCiFetchError).code,
      "php_error_page",
      "error code",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Educarriere fetch accepts a valid empty source page when displayed count is zero", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(pageHtml({ displayedCount: 0, cards: "" }), { status: 200 }),
    )) as typeof fetch;
  try {
    const result = await fetchEmploiCiItems(10, { maxPages: 1 });
    assertEquals(result.items.length, 0, "no items");
    assertEquals(result.stopped_reason, "empty_valid_source", "stop reason");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Educarriere pagination stops after consecutive pages without new ids", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    return Promise.resolve(
      new Response(
        pageHtml({
          page: requestedUrls.length,
          maxPages: 99,
          displayedCount: 99,
          cards: card({
            id: 153146,
            slug: "ressources-humaines",
            title: "RESSOURCES HUMAINES",
            company: "VISIONNAIRE",
          }),
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  try {
    const result = await fetchEmploiCiItems(10, {
      maxPages: 10,
      maxConsecutivePagesWithoutNewIds: 2,
    });
    assertEquals(result.items.length, 1, "only one unique offer");
    assertEquals(result.pages_requested, 3, "three pages requested");
    assertEquals(result.stopped_reason, "pagination_stalled", "stop reason");
    assertEquals(
      requestedUrls[0],
      "https://emploi.educarriere.ci/emploi-accueil",
      "first page URL",
    );
    assertEquals(
      requestedUrls[1],
      "https://emploi.educarriere.ci/emploi-accueil?page=2",
      "second page URL",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
