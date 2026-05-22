const form = document.querySelector("#search-form");
const categoryInput = document.querySelector("#target-category");
const categoryList = document.querySelector("#category-list");
const progress = document.querySelector("#progress");
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
const submitButton = document.querySelector("#submit-button");
const rateLimitStatus = document.querySelector("#rate-limit-status");
const rateLimitToggle = document.querySelector("#rate-limit-toggle");

let categories = [];

loadCategories();
initRateLimitToggle();

categoryInput.addEventListener("input", () => renderCategorySuggestions(categoryInput.value));
categoryInput.addEventListener("focus", () => renderCategorySuggestions(categoryInput.value));
categoryInput.addEventListener("keydown", handleCategoryKeydown);
rateLimitToggle.addEventListener("change", toggleRateLimit);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".category-field")) hideCategorySuggestions();
});

async function initRateLimitToggle() {
  try {
    const response = await fetch("/api/rate-limit");
    const data = await response.json();
    rateLimitToggle.checked = data.enabled;
    updateRateLimitText(data.enabled);
  } catch (error) {
    console.error("Failed to fetch rate limit status:", error);
  }
}

function updateRateLimitText(enabled) {
  const text = rateLimitStatus.querySelector(".rate-limit-text");
  text.textContent = enabled ? "Rate limiting ON" : "Rate limiting OFF";
}

async function toggleRateLimit() {
  try {
    const enabled = rateLimitToggle.checked;
    const response = await fetch("/api/rate-limit/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    updateRateLimitText(data.enabled);
  } catch (error) {
    console.error("Failed to toggle rate limit:", error);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearOutput();

  const payload = Object.fromEntries(new FormData(form).entries());
  const targetCategory = resolveCategoryInput(payload.targetCategory);
  if (!targetCategory) {
    showError("Please choose an official arXiv category from the suggestions, for example cs.CV or physics.optics.");
    renderCategorySuggestions(payload.targetCategory);
    return;
  }
  payload.targetCategory = targetCategory;
  categoryInput.value = targetCategory;
  hideCategorySuggestions();

  setLoading(true);
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed.");
    renderResults(data);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
});

async function loadCategories() {
  try {
    const response = await fetch("/api/categories");
    const data = await response.json();
    categories = data.categories;
  } catch (error) {
    showError("Could not load arXiv categories. Please refresh the page.");
    console.error("Failed to load categories:", error);
  }
}

function renderSummary(data) {
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="summary-item">
      <span>Category</span>
      <b>${escapeHtml(data.targetCategory)}</b>
    </div>
    <div class="summary-item">
      <span>Recent window</span>
      <b>${data.recentYears} years</b>
    </div>
    <div class="summary-item">
      <span>Papers found</span>
      <b>${data.searchedPaperCount}</b>
    </div>
    <div class="summary-item">
      <span>Candidates</span>
      <b>${data.candidates.length}</b>
    </div>
  `;
}

function renderCategorySuggestions(value) {
  const hasQuery = Boolean(normalizeCategorySearch(value));
  const matches = getCategoryMatches(value).slice(0, hasQuery ? 8 : categories.length);
  if (!matches.length) {
    categoryList.innerHTML = "";
    hideCategorySuggestions();
    return;
  }

  categoryList.innerHTML = matches
    .map(
      (category) => `
        <button class="category-option" type="button" role="option" data-category="${escapeAttribute(category)}">
          <span>${escapeHtml(category)}</span>
        </button>
      `
    )
    .join("");
  categoryList.classList.remove("hidden");
  categoryList.querySelectorAll(".category-option").forEach((option) => {
    option.addEventListener("click", () => selectCategory(option.dataset.category));
  });
}

function hideCategorySuggestions() {
  categoryList.classList.add("hidden");
}

function handleCategoryKeydown(event) {
  if (event.key === "Escape") {
    hideCategorySuggestions();
    return;
  }

  if (event.key !== "Enter") return;
  const resolved = resolveCategoryInput(categoryInput.value);
  if (!resolved) return;
  event.preventDefault();
  selectCategory(resolved);
}

function selectCategory(category) {
  categoryInput.value = category;
  hideCategorySuggestions();
  categoryInput.focus();
}

function resolveCategoryInput(value) {
  const trimmed = String(value || "").trim();
  if (categories.includes(trimmed)) return trimmed;

  const normalized = normalizeCategorySearch(trimmed);
  if (!normalized) return "";

  const exactCompactMatches = categories.filter(
    (category) => normalizeCategorySearch(category) === normalized
  );
  if (exactCompactMatches.length === 1) return exactCompactMatches[0];

  const matches = getCategoryMatches(trimmed);
  return matches.length === 1 ? matches[0] : "";
}

function getCategoryMatches(value) {
  const normalized = normalizeCategorySearch(value);
  if (!normalized) return categories;

  return categories
    .map((category) => ({ category, score: getCategoryMatchScore(category, normalized) }))
    .filter((match) => match.score < 99)
    .sort((a, b) => a.score - b.score || a.category.localeCompare(b.category))
    .map((match) => match.category);
}

function getCategoryMatchScore(category, normalizedQuery) {
  const normalizedCategory = normalizeCategorySearch(category);
  const parts = category.toLowerCase().split(".");
  const primary = normalizeCategorySearch(parts[0]);
  const secondary = normalizeCategorySearch(parts[1] || "");

  if (normalizedCategory === normalizedQuery) return 0;
  if (category.toLowerCase() === normalizedQuery) return 1;
  if (primary === normalizedQuery || secondary === normalizedQuery) return 2;
  if (secondary.startsWith(normalizedQuery)) return 3;
  if (primary.startsWith(normalizedQuery)) return 4;
  if (normalizedCategory.startsWith(normalizedQuery)) return 5;
  if (normalizedCategory.includes(normalizedQuery)) return 6;
  return 99;
}

function normalizeCategorySearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function renderResults(data) {
  renderSummary(data);

  const candidates = data.candidates;

  if (!candidates.length) {
    results.innerHTML = `
      <div class="empty">
        <h3>No potential candidates found</h3>
        <p class="muted">Try a larger paper budget or add a PI/collaborator name.</p>
      </div>
    `;
    return;
  }

  results.innerHTML = candidates.map(renderCandidate).join("");
}

function renderCandidate(candidate) {
  const paperCount = candidate.paperCount || 1;
  const hasConnection = Boolean(candidate.piConnection);
  const abstractUrl = escapeAttribute(candidate.abstractUrl);
  const endorserUrl = escapeAttribute(`https://arxiv.org/auth/show-endorsers/${candidate.sourcePaper}`);
  const title = candidate.sourceTitle ? `<p class="candidate-paper">${escapeHtml(candidate.sourceTitle)}</p>` : "";

  return `
    <article class="result-card">
      <h3 class="candidate-name">${escapeHtml(candidate.name)}</h3>
      ${title}
      <div class="candidate-tags">
        <span class="tag">${paperCount} related paper${paperCount === 1 ? "" : "s"}</span>
        <span class="tag ${hasConnection ? "tag-yes" : "tag-no"}">${hasConnection ? "has connection" : "no connection"}</span>
        <span class="tag">${escapeHtml(candidate.authorRole || "coauthor")}</span>
      </div>
      <div class="candidate-links">
        <a href="${abstractUrl}" target="_blank" rel="noreferrer">Open arXiv paper</a>
        <a href="${endorserUrl}" target="_blank" rel="noreferrer">Validate endorser</a>
      </div>
    </article>
  `;
}

function showError(message) {
  results.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function clearOutput() {
  results.innerHTML = "";
  summary.innerHTML = "";
  summary.classList.add("hidden");
}

function setLoading(isLoading) {
  progress.classList.toggle("hidden", !isLoading);
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Searching..." : "Find candidates";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
