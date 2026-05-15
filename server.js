import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
// Use /tmp for cache in serverless environments (Vercel), fallback to local .cache for development
const CACHE_DIR = process.env.VERCEL ? "/tmp/.cache" : join(ROOT, ".cache");
const PORT = Number(process.env.PORT || 3000);
const USER_AGENT =
  "arXivEndorserFinder/0.1 (responsible crawler; contact: local-development)";
const ARXIV_API = "https://export.arxiv.org/api/query";
const ARXIV_ORIGIN = "https://arxiv.org";

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  minDelayMs: Number(process.env.ARXIV_MIN_DELAY_MS) || 5000,        // Minimum delay between requests (5 seconds default)
  maxDelayMs: Number(process.env.ARXIV_MAX_DELAY_MS) || 30000,       // Maximum delay for exponential backoff
  baseBackoffMs: Number(process.env.ARXIV_BASE_BACKOFF_MS) || 10000, // Base backoff on rate limit hit
  defaultCooldownMs: 10 * 60 * 1000,                                  // Default cooldown when rate limited (10 minutes)
  maxRetries: 3,                                                      // Max retries per request
  burstLimit: 5,                                                      // Max requests before forced cooldown
  burstCooldownMs: 60000,                                             // Cooldown after burst limit (1 minute)
};

const API_PAGE_SIZE = 100;
const DEFAULT_PAPER_LIMIT = 100;
const MAX_PAPERS = 5000;
const RECENT_YEARS = 5;

// Rate limiting state
let lastArxivRequestAt = 0;
let arxivRateLimitedUntil = 0;
let consecutiveRequests = 0;
let lastBurstResetAt = Date.now();
let currentBackoffMultiplier = 1;

const ARXIV_CATEGORIES = [
  "astro-ph.CO",
  "astro-ph.EP",
  "astro-ph.GA",
  "astro-ph.HE",
  "astro-ph.IM",
  "astro-ph.SR",
  "cond-mat.dis-nn",
  "cond-mat.mes-hall",
  "cond-mat.mtrl-sci",
  "cond-mat.other",
  "cond-mat.quant-gas",
  "cond-mat.soft",
  "cond-mat.stat-mech",
  "cond-mat.str-el",
  "cond-mat.supr-con",
  "cs.AI",
  "cs.AR",
  "cs.CC",
  "cs.CE",
  "cs.CG",
  "cs.CL",
  "cs.CR",
  "cs.CV",
  "cs.CY",
  "cs.DB",
  "cs.DC",
  "cs.DL",
  "cs.DM",
  "cs.DS",
  "cs.ET",
  "cs.FL",
  "cs.GL",
  "cs.GR",
  "cs.GT",
  "cs.HC",
  "cs.IR",
  "cs.IT",
  "cs.LG",
  "cs.LO",
  "cs.MA",
  "cs.MM",
  "cs.MS",
  "cs.NA",
  "cs.NE",
  "cs.NI",
  "cs.OH",
  "cs.OS",
  "cs.PF",
  "cs.PL",
  "cs.RO",
  "cs.SC",
  "cs.SD",
  "cs.SE",
  "cs.SI",
  "cs.SY",
  "econ.EM",
  "econ.GN",
  "econ.TH",
  "eess.AS",
  "eess.IV",
  "eess.SP",
  "eess.SY",
  "gr-qc",
  "hep-ex",
  "hep-lat",
  "hep-ph",
  "hep-th",
  "math.AC",
  "math.AG",
  "math.AP",
  "math.AT",
  "math.CA",
  "math.CO",
  "math.CT",
  "math.CV",
  "math.DG",
  "math.DS",
  "math.FA",
  "math.GM",
  "math.GN",
  "math.GR",
  "math.GT",
  "math.HO",
  "math.IT",
  "math.KT",
  "math.LO",
  "math.MG",
  "math.MP",
  "math.NA",
  "math.NT",
  "math.OA",
  "math.OC",
  "math.PR",
  "math.QA",
  "math.RA",
  "math.RT",
  "math.SG",
  "math.SP",
  "math.ST",
  "math-ph",
  "nlin.AO",
  "nlin.CD",
  "nlin.CG",
  "nlin.PS",
  "nlin.SI",
  "nucl-ex",
  "nucl-th",
  "physics.acc-ph",
  "physics.ao-ph",
  "physics.app-ph",
  "physics.atm-clus",
  "physics.atom-ph",
  "physics.bio-ph",
  "physics.chem-ph",
  "physics.class-ph",
  "physics.comp-ph",
  "physics.data-an",
  "physics.ed-ph",
  "physics.flu-dyn",
  "physics.gen-ph",
  "physics.geo-ph",
  "physics.hist-ph",
  "physics.ins-det",
  "physics.med-ph",
  "physics.optics",
  "physics.plasm-ph",
  "physics.pop-ph",
  "physics.soc-ph",
  "physics.space-ph",
  "q-bio.BM",
  "q-bio.CB",
  "q-bio.GN",
  "q-bio.MN",
  "q-bio.NC",
  "q-bio.OT",
  "q-bio.PE",
  "q-bio.QM",
  "q-bio.SC",
  "q-bio.TO",
  "q-fin.CP",
  "q-fin.EC",
  "q-fin.GN",
  "q-fin.MF",
  "q-fin.PM",
  "q-fin.PR",
  "q-fin.RM",
  "q-fin.ST",
  "q-fin.TR",
  "quant-ph",
  "stat.AP",
  "stat.CO",
  "stat.ME",
  "stat.ML",
  "stat.OT",
  "stat.TH"
];

const CATEGORY_SET = new Set(ARXIV_CATEGORIES);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/categories") {
      return sendJson(res, { categories: ARXIV_CATEGORIES });
    }

    if (req.method === "GET" && url.pathname === "/api/rate-limit") {
      const status = getRateLimitStatus();
      return sendJson(res, {
        ...status,
        config: {
          minDelayMs: RATE_LIMIT_CONFIG.minDelayMs,
          maxDelayMs: RATE_LIMIT_CONFIG.maxDelayMs,
          burstLimit: RATE_LIMIT_CONFIG.burstLimit,
          burstCooldownMs: RATE_LIMIT_CONFIG.burstCooldownMs,
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/rate-limit/reset") {
      currentBackoffMultiplier = 1;
      consecutiveRequests = 0;
      arxivRateLimitedUntil = 0;
      lastBurstResetAt = Date.now();
      console.log("[Rate Limit] Manually reset by user");
      return sendJson(res, { message: "Rate limit state reset", status: getRateLimitStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      const payload = await readJson(req);
      const results = await findPotentialEndorsers(payload);
      return sendJson(res, results);
    }

    if (req.method !== "GET") {
      return sendJson(res, { error: "Method not allowed" }, 405);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(
      res,
      { error: error.message || "Unexpected server error" },
      error.statusCode || 500
    );
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`arXivEndorserFinder running at http://localhost:${PORT}`);
});

async function findPotentialEndorsers(input) {
  const targetCategory = String(input.targetCategory || "").trim();
  const connection = cleanOptional(input.connection);
  const connectionCategory = cleanOptional(input.connectionCategory);
  const connectionType = getConnectionTypes(connectionCategory, connection);
  const institution = cleanOptional(input.institution) || (connectionType.includes("institution") ? connection : null);
  const piName = cleanOptional(input.piName) || (connectionType.includes("person") ? connection : null);
  const maxResults = clamp(Number(input.maxResults || DEFAULT_PAPER_LIMIT), 10, MAX_PAPERS);
  const recentRange = getRecentSubmittedRange(RECENT_YEARS);

  if (!CATEGORY_SET.has(targetCategory)) {
    const error = new Error("Please choose an exact official arXiv category.");
    error.statusCode = 400;
    throw error;
  }

  const focusedSearch = Boolean(institution || piName);
  const paperGroups = [];
  let piCoauthors = new Set();

  if (institution) {
    const institutionQuery = buildCategoryKeywordQuery(targetCategory, institution, recentRange);
    if (institutionQuery) {
      paperGroups.push({
        type: "institution",
        label: `Institution text match: ${institution}`,
        papers: await searchArxiv({
          query: institutionQuery,
          maxResults
        })
      });
    }
  }

  if (piName) {
    const piAllPapers = await searchArxiv({
      query: `au:"${escapeQuery(piName)}"`,
      maxResults: Math.min(maxResults, 100)
    });
    piCoauthors = extractPiCoauthors(piAllPapers, piName);

    paperGroups.push({
      type: "pi",
      label: `PI / senior collaborator papers in ${targetCategory}: ${piName}`,
      papers: await searchArxiv({
        query: `cat:${targetCategory} AND au:"${escapeQuery(piName)}" AND ${recentRange}`,
        maxResults: Math.min(maxResults, 100)
      })
    });

    const coauthorNames = getDirectCoauthorNames(piAllPapers, piName).slice(0, 12);
    const coauthorQuery = buildCategoryAuthorOrQuery(targetCategory, coauthorNames, recentRange);
    if (coauthorQuery) {
      paperGroups.push({
        type: "pi-coauthor",
        label: `Direct PI coauthors in ${targetCategory}: ${coauthorNames.join(", ")}`,
        papers: await searchArxiv({
          query: coauthorQuery,
          maxResults: Math.min(maxResults, 100)
        })
      });
    }
  }

  if (!focusedSearch) {
    paperGroups.push({
      type: "category",
      label: `Recent papers in ${targetCategory}`,
      papers: await searchArxiv({
        query: `cat:${targetCategory} AND ${recentRange}`,
        maxResults
      })
    });
  }

  const rawPapers = dedupePapers(paperGroups.flatMap((group) => group.papers));
  const papers = rawPapers;
  const candidates = rankPotentialCandidates({
    papers,
    paperGroups,
    targetCategory,
    institution,
    piName,
    piCoauthors
  });

  const searchedPapers = papers.map((paper) => ({
    arxivId: paper.arxivId,
    title: paper.title,
    absUrl: paper.absUrl,
    authors: paper.authors,
    sourceCategory: paper.primaryCategory,
    publishedAt: paper.publishedAt,
    institutionEvidence: institution ? getInstitutionEvidence(paper, institution) : ""
  }));

  return {
    targetCategory,
    recentYears: RECENT_YEARS,
    searchStrategy: {
      focusedSearch,
      connection,
      connectionCategory,
      connectionType,
      institution,
      piName,
      groups: paperGroups.map((group) => ({
        label: group.label,
        count: group.papers.length
      })),
      rawPaperCount: rawPapers.length,
      institutionEvidenceCount: institution
        ? rawPapers.filter((paper) => getInstitutionEvidence(paper, institution)).length
        : 0,
      institutionFullName: institution
    },
    searchedPaperCount: papers.length,
    searchedPapers,
    candidates,
    guidance:
      "These are potential endorsers inferred from recent arXiv metadata only. Open a listed arXiv paper yourself and use the arXiv page's manual endorser check link to confirm eligibility."
  };
}

function isArxivRateLimited() {
  return Date.now() < arxivRateLimitedUntil;
}

function getRateLimitStatus() {
  const now = Date.now();
  const isLimited = now < arxivRateLimitedUntil;
  const remainingMs = isLimited ? arxivRateLimitedUntil - now : 0;
  const timeSinceLastRequest = now - lastArxivRequestAt;
  
  return {
    isLimited,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    consecutiveRequests,
    currentDelay: getCurrentDelay(),
    timeSinceLastRequest,
    backoffMultiplier: currentBackoffMultiplier,
  };
}

function getCurrentDelay() {
  const baseDelay = RATE_LIMIT_CONFIG.minDelayMs * currentBackoffMultiplier;
  return Math.min(baseDelay, RATE_LIMIT_CONFIG.maxDelayMs);
}

function resetBurstCounterIfNeeded() {
  const now = Date.now();
  if (now - lastBurstResetAt > RATE_LIMIT_CONFIG.burstCooldownMs) {
    consecutiveRequests = 0;
    lastBurstResetAt = now;
    currentBackoffMultiplier = Math.max(1, currentBackoffMultiplier * 0.5); // Gradually reduce backoff
  }
}

function handleRateLimitHit(retryAfter) {
  currentBackoffMultiplier = Math.min(currentBackoffMultiplier * 2, 4); // Max 4x backoff
  const baseDelay = RATE_LIMIT_CONFIG.defaultCooldownMs;
  const delay = getRetryDelayMs({ retryAfter }, baseDelay * currentBackoffMultiplier);
  arxivRateLimitedUntil = Date.now() + delay;
  console.log(`[Rate Limit] Hit rate limit. Cooling down for ${Math.ceil(delay / 1000)} seconds. Backoff multiplier: ${currentBackoffMultiplier}x`);
  return delay;
}

async function searchArxiv({ query, maxResults }) {
  const papers = [];
  for (let start = 0; start < maxResults; start += API_PAGE_SIZE) {
    const pageSize = Math.min(API_PAGE_SIZE, maxResults - start);
    const page = await searchArxivPage({ query, start, maxResults: pageSize });
    papers.push(...page);
    if (page.length < pageSize) break;
  }
  return dedupePapers(papers).slice(0, maxResults);
}

async function searchArxivPage({ query, start, maxResults }) {
  const params = new URLSearchParams({
    search_query: query,
    start: String(start),
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });
  const xml = await cachedFetchText(`${ARXIV_API}?${params.toString()}`, "api");
  return parseArxivFeed(xml);
}

function buildCategoryKeywordQuery(category, text, recentRange) {
  const institutionName = cleanOptional(text);
  if (!institutionName) return "";
  return [`cat:${category}`, recentRange, `all:"${escapeQuery(institutionName)}"`].join(" AND ");
}

function buildCategoryAuthorOrQuery(category, authors, recentRange) {
  const authorTerms = authors
    .map((author) => String(author || "").trim())
    .filter(Boolean)
    .map((author) => `au:"${escapeQuery(author)}"`);

  if (!authorTerms.length) return "";
  return `cat:${category} AND ${recentRange} AND (${authorTerms.join(" OR ")})`;
}

function classifyConnection(connection) {
  if (!connection) return [];
  const normalized = normalizeForMatch(connection);
  const hasInstitutionWord =
    /\b(university|college|institute|institution|school|department|laboratory|lab|center|centre|clinic|hospital|academy|corporation|inc|llc|gmbh|ltd)\b/.test(
      normalized
    );
  const words = connection.split(/\s+/).filter(Boolean);
  const looksLikePersonName =
    words.length >= 2 &&
    words.length <= 5 &&
    words.every((word) => /^[A-Z][A-Za-z'.-]*$/.test(word) || /^[A-Z]\.$/.test(word));

  if (hasInstitutionWord) return ["institution"];
  if (looksLikePersonName) return ["person"];
  return ["institution", "person"];
}

function getConnectionTypes(connectionCategory, connection) {
  if (connectionCategory === "institution") return connection ? ["institution"] : [];
  if (connectionCategory === "person") return connection ? ["person"] : [];
  return classifyConnection(connection);
}

function getInstitutionEvidence(paper, institution) {
  const fullName = cleanOptional(institution);
  if (!fullName) return "";
  const metadata = [
    paper.title,
    paper.summary,
    paper.comment,
    paper.journalRef,
    paper.authors.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedMetadata = normalizeForMatch(metadata);
  const normalizedInstitution = normalizeForMatch(fullName);

  if (normalizedInstitution && normalizedMetadata.includes(normalizedInstitution)) {
    return `arXiv metadata explicitly contains "${fullName}".`;
  }
  return "";
}

async function cachedFetchText(url, namespace) {
  assertAllowedUrl(url);
  await mkdir(join(CACHE_DIR, namespace), { recursive: true });
  const cachePath = join(
    CACHE_DIR,
    namespace,
    `${createHash("sha256").update(url).digest("hex")}.txt`
  );

  try {
    return await readFile(cachePath, "utf8");
  } catch {
    if (isArxivRateLimited()) {
      const error = new Error(
        "arXiv is rate-limiting requests right now. Please wait a few minutes and try again; cached results will still be reused."
      );
      error.statusCode = 429;
      throw error;
    }

    await waitForArxivRateLimit();
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.8"
      }
    });
    if (!response.ok) {
if (response.status === 429) {
  const retryAfter = response.headers.get("retry-after") || "";
  const cooldownMs = handleRateLimitHit(retryAfter);
  const status = getRateLimitStatus();
  const error = new Error(
    `arXiv is rate-limiting requests. Please wait ${status.remainingSeconds} seconds and try again. Cached results will still be reused. (Backoff: ${status.backoffMultiplier}x)`
  );
  error.statusCode = response.status;
  error.url = url;
  error.retryAfter = retryAfter;
  error.cooldownMs = cooldownMs;
  throw error;
  }
      const error = new Error(`arXiv request failed (${response.status}) for ${url}`);
      error.statusCode = response.status;
      error.url = url;
      throw error;
    }
    const text = await response.text();
    await writeFile(cachePath, text);
    return text;
  }
}

function getRetryDelayMs(error, fallbackMs) {
  const retryAfter = String(error.retryAfter || "").trim();
  if (/^\d+$/.test(retryAfter)) {
    return Math.max(Number(retryAfter) * 1000, fallbackMs);
  }
  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(retryDate - Date.now(), fallbackMs);
  }
  return fallbackMs;
}

function assertAllowedUrl(url) {
  const parsed = new URL(url);
  const isApi = parsed.origin === "https://export.arxiv.org" && parsed.pathname === "/api/query";

  if (!isApi) {
    throw new Error(`Crawler target is not allowed: ${url}`);
  }
}

async function waitForArxivRateLimit() {
  resetBurstCounterIfNeeded();
  
  // Check burst limit
  if (consecutiveRequests >= RATE_LIMIT_CONFIG.burstLimit) {
    const burstWait = RATE_LIMIT_CONFIG.burstCooldownMs;
    console.log(`[Rate Limit] Burst limit reached (${consecutiveRequests} requests). Waiting ${burstWait / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, burstWait));
    consecutiveRequests = 0;
    lastBurstResetAt = Date.now();
  }
  
  const currentDelay = getCurrentDelay();
  const elapsed = Date.now() - lastArxivRequestAt;
  
  if (elapsed < currentDelay) {
    const waitTime = currentDelay - elapsed;
    console.log(`[Rate Limit] Waiting ${Math.ceil(waitTime / 1000)}s before next request (delay: ${currentDelay}ms, backoff: ${currentBackoffMultiplier}x)`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  
  lastArxivRequestAt = Date.now();
  consecutiveRequests++;
}

function rankPotentialCandidates({ papers, paperGroups, targetCategory, institution, piName, piCoauthors }) {
  const byName = new Map();
  const paperSignals = buildPaperSignals(paperGroups);

  for (const paper of papers) {
    const signals = paperSignals.get(normalizeArxivId(paper.arxivId)) || new Set(["category"]);
    const institutionEvidence = institution ? getInstitutionEvidence(paper, institution) : "";
    const targetCategoryMatch = paper.categories.includes(targetCategory);

    paper.authors.forEach((name, index) => {
      const key = normalizeName(name);
      if (!key) return;
      const current = byName.get(key) || {
        name,
        appearances: [],
        categories: new Set(),
        signals: new Set(),
        institutionEvidence: ""
      };

      current.appearances.push({
        paper,
        index,
        authorCount: paper.authors.length,
        targetCategoryMatch,
        position: getAuthorPosition(index, paper.authors.length)
      });
      for (const category of paper.categories) current.categories.add(category);
      for (const signal of signals) current.signals.add(signal);
      if (!current.institutionEvidence && institutionEvidence) {
        current.institutionEvidence = institutionEvidence;
      }
      byName.set(key, current);
    });
  }

  return [...byName.values()]
    .map((candidate) => {
      const targetAppearances = candidate.appearances.filter((appearance) => appearance.targetCategoryMatch);
      const scoringAppearances = targetAppearances.length ? targetAppearances : candidate.appearances;
      const bestAppearance = pickBestAppearance(scoringAppearances, targetCategory);
      const sourcePaper = bestAppearance.paper;
      const exactCategory = candidate.categories.has(targetCategory);
      const piConnection = getPiConnection(candidate.name, piName, piCoauthors);
      const authorPositionScore = getAuthorPositionScore(bestAppearance.position);
      const categoryScore = exactCategory ? 20 : 0;
      const recentPaperScore = getRecentPaperPointScore(sourcePaper.publishedAt);
      const piScore = piConnection.level === 1 ? 30 : piConnection.level === 2 ? 10 : 0;
      const institutionScore = candidate.institutionEvidence ? 25 : 0;
      const repeatedActivityScore = Math.max(0, targetAppearances.length - 1) * 10;
      const totalScore =
        categoryScore +
        recentPaperScore +
        authorPositionScore +
        piScore +
        institutionScore +
        repeatedActivityScore;

      const relevance = buildRelevanceReasons({
        candidate,
        targetCategory,
        institution,
        piConnection,
        exactCategory,
        bestAppearance,
        targetPaperCount: targetAppearances.length
      });

      return {
        name: candidate.name,
        affiliation: inferAffiliation(candidate.institutionEvidence, institution),
        sourcePaper: sourcePaper.arxivId,
        sourceTitle: sourcePaper.title,
        sourceCategory: sourcePaper.primaryCategory,
        categories: [...candidate.categories],
        publishedAt: sourcePaper.publishedAt,
        abstractUrl: sourcePaper.absUrl,
        potentialEndorser: true,
        categoryMatch: exactCategory,
        confidence: getConfidenceLabel(bestAppearance.position, targetAppearances.length),
        piConnection: piConnection.text,
        paperCount: targetAppearances.length || candidate.appearances.length,
        authorRole: getAuthorPositionLabel(bestAppearance.position),
        authorPosition: bestAppearance.position,
        institutionMatch: candidate.institutionEvidence,
        scores: {
          total: totalScore,
          category: categoryScore,
          piConnection: piScore,
          institution: institutionScore,
          repeatedActivity: repeatedActivityScore,
          authorPosition: authorPositionScore,
          recentPaper: recentPaperScore
        },
        rankingReason: relevance.join(" "),
        manualCheckInstruction:
          "Ownership cannot be reliably checked without arXiv login. Open this arXiv paper, log in if needed, then use the page-bottom link named \"Which authors of this paper are endorsers?\" to manually confirm eligibility."
      };
    }
    )
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, 12);
}

function buildPaperSignals(paperGroups) {
  const signals = new Map();
  for (const group of paperGroups) {
    for (const paper of group.papers) {
      const key = normalizeArxivId(paper.arxivId);
      const current = signals.get(key) || new Set();
      current.add(group.type || "category");
      signals.set(key, current);
    }
  }
  return signals;
}

function pickBestAppearance(appearances, targetCategory) {
  return [...appearances].sort((a, b) => {
    const aExact = a.paper.categories.includes(targetCategory) ? 1 : 0;
    const bExact = b.paper.categories.includes(targetCategory) ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const positionDelta = getAuthorPositionScore(b.position) - getAuthorPositionScore(a.position);
    if (positionDelta !== 0) return positionDelta;

    return new Date(b.paper.publishedAt).getTime() - new Date(a.paper.publishedAt).getTime();
  })[0];
}

function buildRelevanceReasons({ candidate, targetCategory, institution, piConnection, exactCategory, bestAppearance, targetPaperCount }) {
  const reasons = [];
  if (exactCategory) {
    reasons.push(`${getAuthorPositionEvidence(bestAppearance.position)} on a recent arXiv paper in ${targetCategory}.`);
  }
  reasons.push("Paper is within the last five years.");
  if (piConnection.text) reasons.push(piConnection.text);
  if (candidate.institutionEvidence) {
    reasons.push(candidate.institutionEvidence);
  } else if (institution) {
    reasons.push(`Institution full name was used exactly as entered: ${institution}.`);
  }
  if (targetPaperCount > 1) {
    reasons.push(`${targetPaperCount} recent target-category arXiv papers found.`);
  }
  if (["middle", "late", "last"].includes(bestAppearance.position)) {
    reasons.push("Ownership is not confirmed, so this lower author-position signal is discounted.");
  }
  return reasons;
}

function inferAffiliation(institutionEvidence, institution) {
  if (institutionEvidence && institution) return `Possible ${institution} connection`;
  if (institution) return `Institution not confirmed; ${institution} used as a search signal`;
  return "Not inferred from arXiv metadata";
}

function getPiConnection(name, piName, piCoauthors) {
  if (!piName) return { level: null, text: "" };
  if (normalizeName(name) === normalizeName(piName)) {
    return { level: 0, text: "Candidate matches the PI/senior collaborator name provided." };
  }
  if (piCoauthors.has(normalizeName(name))) {
    return { level: 1, text: "Direct coauthor of the PI/advisor in recent arXiv metadata." };
  }
  return { level: null, text: "" };
}

function getAuthorPosition(index, authorCount) {
  if (index === 0) return "first";
  if (index === 1) return "second";
  if (index === 2) return "third";
  if (index === authorCount - 1) return "last";
  if (index >= Math.max(3, authorCount - 2)) return "late";
  return "middle";
}

function getAuthorPositionScore(position) {
  const scores = {
    confirmedOwner: 100,
    first: 50,
    second: 35,
    third: 25,
    middle: 10,
    last: 15,
    late: 5
  };
  return scores[position] || 0;
}

function getAuthorPositionLabel(position) {
  const labels = {
    first: "first author",
    second: "second author",
    third: "third author",
    middle: "middle author",
    last: "last author",
    late: "late coauthor"
  };
  return labels[position] || "coauthor";
}

function getAuthorPositionEvidence(position) {
  const labels = {
    first: "First author",
    second: "Second author",
    third: "Third author",
    middle: "Middle author",
    last: "Last author",
    late: "Late coauthor"
  };
  return labels[position] || "Coauthor";
}

function getConfidenceLabel(position, targetPaperCount) {
  if (position === "first" && targetPaperCount > 1) return "Higher-confidence candidate";
  if (position === "first") return "High ownership-likelihood candidate";
  if (position === "second") return "Medium-high ownership-likelihood candidate";
  if (position === "third") return "Medium ownership-likelihood candidate";
  return "Lower-confidence candidate";
}

function getRecentPaperPointScore(publishedAt) {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears <= 1) return 10;
  if (ageYears <= 3) return 7;
  if (ageYears <= 5) return 5;
  return 0;
}

function getRecentSubmittedRange(years) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return `submittedDate:[${formatArxivDate(start)} TO ${formatArxivDate(end)}]`;
}

function formatArxivDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}0000`;
}

function parseArxivFeed(xml) {
  return getTagBlocks(xml, "entry").map((entry) => {
    const idUrl = getTag(entry, "id");
    const arxivId = idUrl.split("/abs/").pop() || idUrl;
    const categories = [...entry.matchAll(/<category[^>]*term=["']([^"']+)["'][^>]*>/gi)].map((m) =>
      decodeHtml(m[1])
    );
    return {
      arxivId,
      title: normalizeSpace(decodeHtml(getTag(entry, "title"))),
      summary: normalizeSpace(decodeHtml(getTag(entry, "summary"))),
      comment: normalizeSpace(decodeHtml(getTag(entry, "arxiv:comment"))),
      journalRef: normalizeSpace(decodeHtml(getTag(entry, "arxiv:journal_ref"))),
      publishedAt: getTag(entry, "published"),
      updatedAt: getTag(entry, "updated"),
      primaryCategory: categories[0] || "",
      categories,
      authors: getTagBlocks(entry, "author").map((author) =>
        normalizeSpace(decodeHtml(getTag(author, "name")))
      ),
      absUrl: `${ARXIV_ORIGIN}/abs/${arxivId}`
    };
  });
}

function getTagBlocks(text, tag) {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...text.matchAll(regex)].map((match) => match[1]);
}

function getTag(text, tag) {
  const match = text.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function extractPiCoauthors(papers, piName) {
  const normalizedPi = normalizeName(piName);
  const coauthors = new Set();
  for (const paper of papers) {
    if (!paper.authors.some((author) => normalizeName(author) === normalizedPi)) continue;
    for (const author of paper.authors) {
      const normalized = normalizeName(author);
      if (normalized && normalized !== normalizedPi) coauthors.add(normalized);
    }
  }
  return coauthors;
}

function getDirectCoauthorNames(papers, piName) {
  const normalizedPi = normalizeName(piName);
  const byNormalizedName = new Map();
  for (const paper of papers) {
    if (!paper.authors.some((author) => normalizeName(author) === normalizedPi)) continue;
    for (const author of paper.authors) {
      const normalized = normalizeName(author);
      if (normalized && normalized !== normalizedPi && !byNormalizedName.has(normalized)) {
        byNormalizedName.set(normalized, author);
      }
    }
  }
  return [...byNormalizedName.values()];
}

function dedupePapers(papers) {
  return [...new Map(papers.map((paper) => [normalizeArxivId(paper.arxivId), paper])).values()];
}

function normalizeArxivId(arxivId) {
  return String(arxivId || "").replace(/v\d+$/, "");
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptional(value) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function escapeQuery(value) {
  return String(value).replace(/"/g, "");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, data, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data, null, 2));
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, { error: "Not found" }, 404);
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    sendJson(res, { error: "Not found" }, 404);
  }
}
