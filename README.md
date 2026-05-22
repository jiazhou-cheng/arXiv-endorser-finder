# arXiv Endorser Finder

A web tool for finding **potential arXiv endorsers** from recent arXiv metadata.

It helps you search by arXiv category and optionally focus the results around a PI or senior collaborator's coauthor network. The app does **not** automatically verify endorsement eligibility; final validation must be done on arXiv.

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="Home screen" width="560">
</p>

---

## How to Use

### 1. Enter the target arXiv category

- `cs.CV`
- `cs.AI`
- `physics.optics`
- `stat.ML`

The category must match an official arXiv category code.

---

### 2. Choose a paper budget

Start with `100 papers` for a quick search.

Use a larger budget if:

- the category has few results,
- you want broader coverage,
- the first search does not return enough useful candidates.

---

### 3. Add a PI or senior collaborator

This field is optional, but usually very helpful.

<p align="center">
  <img src="docs/screenshots/02-search-form.png" alt="Filled search form" width="560">
</p>

---

### 4. Review candidate results

After clicking **Find candidates**, the app shows a ranked list of possible endorsement leads.

Each candidate card includes:

- candidate name,
- source arXiv paper,
- number of related papers,
- PI/coauthor connection signal,
- author-role signal,
- link to open the paper,
- link to validate the endorser on arXiv.

<p align="center">
  <img src="docs/screenshots/03-results.png" alt="Candidate results" width="560">
</p>

---

## Final Validation

Click **Validate endorser** to open arXiv's manual endorser-check page for the source paper.

arXiv will ask you to log in. The final eligibility decision is made by arXiv, not by this app.