# arXivEndorserFinder Design Doc

## Product Positioning

arXivEndorserFinder is an academic-network-based potential endorser discovery
assistant.

It does not automatically verify endorsement eligibility. It helps users find
likely arXiv endorsers by searching recent arXiv publications in a target
category through PI collaboration networks and institution-related publication
records. The user manually confirms eligibility on arXiv.

## Explicit Non-Goals

- Do not log in to arXiv.
- Do not ask for arXiv credentials.
- Do not crawl `Which authors of this paper are endorsers?` pages.
- Do not access `/auth/show-endorsers/...` pages.
- Do not automate endorser eligibility checks.
- Do not send email or contact candidates.
- Do not guarantee that any candidate can endorse.

## User Inputs

Required:

- `targetCategory`: exact official arXiv category, such as `physics.optics`,
  `cs.CV`, `eess.IV`, or `cond-mat.mes-hall`.

Optional:

- `connectionCategory`: either `institution` or `person`.
- `connection`: shown only after a category is selected; free-text full name of
  the institution or the person. Person means PI or senior collaborator.
  Institution means the full official institution name exactly as the user wants
  it searched. Do not expand abbreviations, aliases, nicknames, or projected
  institution names.

## Search Logic

### Person-Like Connection Provided

1. Search recent arXiv metadata for papers by the provided PI/collaborator.
2. Extract direct coauthors from those papers.
3. Search recent papers in the target category by those coauthors.
4. Rank authors higher when they are direct PI coauthors and active in the
   target category.

### Institution-Like Connection Provided

1. Search recent arXiv metadata in the target category using the exact full
   institution name supplied by the user.
2. Extract authors from matching papers.
3. Rank candidates higher only when arXiv metadata explicitly contains that
   full institution name.

### Ambiguous Connection Provided

If an old client sends a connection without a category, use conservative
classification. Institution search still uses the exact supplied text only.

## Ranking Signals

Candidates are ranked by:

- target arXiv category activity in the last five years,
- direct PI/coauthor-network connection,
- exact full-name institution metadata evidence,
- number of recent matching papers,
- author-position ownership-likelihood proxy,
- recency of the best source paper.

Ownership cannot be reliably checked without arXiv login in this version. If a
public ownership source becomes available, confirmed paper ownership in the
target endorsement domain should outrank all proxy signals. Until then, author
position is scored as:

- confirmed owner: +100,
- first author: +50,
- second author: +35,
- third author: +25,
- middle author: +10,
- last author: +15,
- late coauthor: +5.

Repeated recent target-category activity adds +10 per additional paper.
Direct PI/coauthor-network connection adds +30. Exact institution full-name
evidence adds +25.

## Output

Each candidate card should show:

- candidate name,
- inferred affiliation or institution signal,
- confidence label and why the candidate is relevant,
- recent target-category arXiv paper link,
- concise manual check instruction.

The UI must label results as potential candidates, not verified endorsers.
Late or middle coauthors must be shown as lower-confidence candidates because
ownership is not confirmed.

## Manual Eligibility Check

The user opens a listed arXiv abstract page and manually clicks the page-bottom
link:

```text
Which authors of this paper are endorsers?
```

The final eligibility check happens outside this app.
