const form = document.querySelector("#search-form");
const categoryInput = document.querySelector("#target-category");
const categoryList = document.querySelector("#category-list");
const progress = document.querySelector("#progress");
const results = document.querySelector("#results");
const submitButton = document.querySelector("#submit-button");
const connectionInput = document.querySelector("#connection");
const rateLimitStatus = document.querySelector("#rate-limit-status");
const rateLimitToggle = document.querySelector("#rate-limit-toggle");

let categories = [];

loadCategories();
initRateLimitToggle();

rateLimitToggle.addEventListener("change", toggleRateLimit);

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
  if (!categories.includes(payload.targetCategory)) {
    showError("Please choose an exact official arXiv category, for example cs.CV or physics.optics.");
    return;
  }

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
  const response = await fetch("/api/categories");
  const data = await response.json();
  categories = data.categories;
  categoryList.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
}



function renderSummary(data) {
  const focusLabel = data.searchStrategy.focusedSearch ? "Network focused" : "Category only";
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
    <div class="summary-item">
      <span>Search mode</span>
      <b>${escapeHtml(focusLabel)}</b>
    </div>
  `;
}

function renderResults(data) {
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
  const endorserCheckUrl = `https://arxiv.org/auth/show-endorsers/${candidate.sourcePaper}`;
  
  return `
    <article class="result-card">
      <h3 class="candidate-name">${escapeHtml(candidate.name)}</h3>
      <div class="candidate-tags">
        <span class="tag">${paperCount} related paper${paperCount === 1 ? "" : "s"}</span>
        <span class="tag ${hasConnection ? "tag-yes" : "tag-no"}">${hasConnection ? "has connection" : "no connection"}</span>
      </div>
      <div class="candidate-links">
        <a href="${candidate.abstractUrl}" target="_blank" rel="noreferrer">Open arXiv paper</a>
        <a href="${endorserCheckUrl}" target="_blank" rel="noreferrer">Validate endorser</a>
      </div>
    </article>
  `;
}

function showError(message) {
  results.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function clearOutput() {
  if (results) results.innerHTML = "";
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
