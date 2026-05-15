const form = document.querySelector("#search-form");
const categoryInput = document.querySelector("#target-category");
const categoryList = document.querySelector("#category-list");
const progress = document.querySelector("#progress");
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const submitButton = document.querySelector("#submit-button");
const connectionCategory = document.querySelector("#connection-category");
const connectionDetail = document.querySelector("#connection-detail");
const connectionInput = document.querySelector("#connection");
const rateLimitStatus = document.querySelector("#rate-limit-status");
const resetRateLimitButton = document.querySelector("#reset-rate-limit");
const categoryInfo = document.querySelector("#category-info");
const categoryInfoContent = document.querySelector("#category-info-content");
const categoryInfoLoading = document.querySelector("#category-info-loading");

let categories = [];
let rateLimitInterval = null;
let currentCategoryInfo = null;

loadCategories();
updateConnectionField();
startRateLimitMonitor();

connectionCategory.addEventListener("change", updateConnectionField);
resetRateLimitButton.addEventListener("click", resetRateLimit);
categoryInput.addEventListener("change", handleCategoryChange);
categoryInput.addEventListener("blur", handleCategoryChange);

async function startRateLimitMonitor() {
  await updateRateLimitStatus();
  rateLimitInterval = setInterval(updateRateLimitStatus, 5000);
}

async function updateRateLimitStatus() {
  try {
    const response = await fetch("/api/rate-limit");
    const data = await response.json();
    renderRateLimitStatus(data);
  } catch (error) {
    console.error("Failed to fetch rate limit status:", error);
  }
}

function renderRateLimitStatus(data) {
  rateLimitStatus.classList.remove("hidden");
  const indicator = rateLimitStatus.querySelector(".rate-limit-indicator");
  const text = rateLimitStatus.querySelector(".rate-limit-text");
  
  if (data.isLimited) {
    indicator.className = "rate-limit-indicator limited";
    text.textContent = `Rate limited - wait ${data.remainingSeconds}s (backoff: ${data.backoffMultiplier}x)`;
    rateLimitStatus.classList.add("is-limited");
  } else {
    indicator.className = "rate-limit-indicator ok";
    const delaySeconds = (data.currentDelay / 1000).toFixed(1);
    text.textContent = `Ready - ${data.consecutiveRequests}/${data.config.burstLimit} requests, ${delaySeconds}s delay`;
    rateLimitStatus.classList.remove("is-limited");
  }
}

async function resetRateLimit() {
  try {
    resetRateLimitButton.disabled = true;
    const response = await fetch("/api/rate-limit/reset", { method: "POST" });
    const data = await response.json();
    renderRateLimitStatus(data.status);
  } catch (error) {
    console.error("Failed to reset rate limit:", error);
  } finally {
    resetRateLimitButton.disabled = false;
  }
}

async function handleCategoryChange() {
  const category = categoryInput.value.trim();
  if (!category || !categories.includes(category)) {
    categoryInfo.classList.add("hidden");
    currentCategoryInfo = null;
    return;
  }
  
  await fetchCategoryInfo(category);
}

async function fetchCategoryInfo(category) {
  categoryInfo.classList.remove("hidden");
  categoryInfoLoading.classList.remove("hidden");
  categoryInfoContent.innerHTML = "";
  
  try {
    const response = await fetch(`/api/category-info?category=${encodeURIComponent(category)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to fetch category info");
    currentCategoryInfo = data;
    renderCategoryInfo(data);
  } catch (error) {
    categoryInfoContent.innerHTML = `<p class="muted">Could not load category info: ${escapeHtml(error.message)}</p>`;
  } finally {
    categoryInfoLoading.classList.remove("hidden");
    categoryInfoLoading.classList.add("hidden");
  }
}

function renderCategoryInfo(data) {
  categoryInfoContent.innerHTML = `
    <div class="category-info-grid">
      <div class="category-info-item">
        <span class="category-info-label">Endorsement domain</span>
        <span class="category-info-value">${escapeHtml(data.endorsementDomain)}</span>
      </div>
      <div class="category-info-item">
        <span class="category-info-label">Recent window</span>
        <span class="category-info-value">${escapeHtml(data.recentWindow)}</span>
      </div>
      <div class="category-info-item">
        <span class="category-info-label">Papers required</span>
        <span class="category-info-value"><a href="${escapeHtml(data.verifyUrl)}" target="_blank" rel="noopener">Login to arXiv</a></span>
      </div>
    </div>
  `;
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
    renderSummary(data);
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

function updateConnectionField() {
  const type = connectionCategory.value;
  const hasType = Boolean(type);
  connectionDetail.classList.toggle("is-hidden", !hasType);
  connectionInput.disabled = !hasType;
  connectionInput.required = hasType;

  if (!hasType) {
    connectionInput.value = "";
    connectionInput.placeholder = "Full name";
    return;
  }

  connectionInput.placeholder =
    type === "institution" ? "Full official institution name" : "Full name of PI or senior collaborator";
}

function renderSummary(data) {
  summary.classList.remove("hidden");
  summary.innerHTML = `
  <div class="summary-item">
  <span>Recent window</span>
  <b>3 months - 5 years</b>
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

function renderResults(data) {
  const candidates = data.candidates;
  const noFocusedPapers = data.searchStrategy.focusedSearch && data.searchedPaperCount === 0;

  if (!candidates.length) {
    results.innerHTML = `
      <div class="empty">
        <h3>${noFocusedPapers ? "No focused papers found" : "No potential candidates found"}</h3>
        <p class="muted">${getEmptyMessage(data, noFocusedPapers)}</p>
      </div>
    `;
    return;
  }

  results.innerHTML = `
    <div class="empty">
      <h3>Manual confirmation required</h3>
      <p class="muted">${escapeHtml(data.guidance)}</p>
    </div>
    ${candidates.map(renderCandidate).join("")}
  `;
}

function getEmptyMessage(data, noFocusedPapers) {
  if (noFocusedPapers) {
    return "No recent papers matched the focused query. For institutions, enter the full official institution name exactly. For people, enter the full name of a PI or senior collaborator.";
  }
  if (data.searchStrategy.focusedSearch) {
    return "The focused search found papers, but no candidate survived ranking. Try increasing the paper budget or using a full official institution name / full person name.";
  }
  return "Try a larger paper budget, add a PI/collaborator, or search a neighboring category.";
}

function renderCandidate(candidate) {
  const score = Math.round(candidate.scores.total);
  const categoryClass = candidate.categoryMatch ? "pill strong" : "pill";
  return `
    <article class="result-card">
      <div class="result-head">
        <div>
          <h3>${escapeHtml(candidate.name)}</h3>
          <p class="muted">${escapeHtml(candidate.confidence)} · ${escapeHtml(candidate.affiliation)}</p>
        </div>
        <div class="score" aria-label="Ranking score">
          <span>Score</span>
          <b>${score}</b>
        </div>
      </div>

      <div class="meta-row">
        <span class="${categoryClass}">${candidate.categoryMatch ? "Target category" : "Related category"}</span>
        <span class="pill">${escapeHtml(candidate.sourceCategory)}</span>
        <span class="pill">${escapeHtml(candidate.authorRole)}</span>
        <span class="pill">${candidate.paperCount} recent paper${candidate.paperCount === 1 ? "" : "s"}</span>
        ${candidate.piConnection ? `<span class="pill strong">PI network</span>` : ""}
      </div>

      <p>${escapeHtml(candidate.rankingReason)}</p>

      <div class="score-row">
        <span class="pill">Category ${candidate.scores.category}</span>
        <span class="pill">PI ${candidate.scores.piConnection}</span>
        <span class="pill">Institution ${candidate.scores.institution}</span>
        <span class="pill">Repeated activity ${candidate.scores.repeatedActivity}</span>
        <span class="pill">Author position ${candidate.scores.authorPosition}</span>
        <span class="pill">Recent paper ${candidate.scores.recentPaper}</span>
      </div>

      <div class="evidence">
        <div><strong>Potential candidate found:</strong> Yes. Ownership is not confirmed.</div>
        <div><strong>Recent arXiv paper:</strong> ${escapeHtml(candidate.sourcePaper)} · ${escapeHtml(candidate.sourceTitle)}</div>
        <div><strong>Evidence:</strong> ${escapeHtml(candidate.rankingReason)}</div>
        <div><strong>Manual check:</strong> ${escapeHtml(candidate.manualCheckInstruction)}</div>
        <div>
          <a href="${candidate.abstractUrl}" target="_blank" rel="noreferrer">Open arXiv paper</a>
        </div>
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
