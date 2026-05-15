# arXivEndorserFinder

A local arXiv potential endorser discovery assistant.

This version is not an automatic endorser checker. It helps users find likely
potential endorsers by searching recent arXiv publications in a target category
through PI/coauthor networks and institution-related metadata signals.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## What It Does

- validates exact official arXiv category codes,
- searches recent metadata through the official arXiv API,
- uses an optional connection category field: `Institution` or `Person - PI or senior collaborator`,
- shows a full-name connection input after the user chooses a connection category,
- requires the full official institution name for institution search,
- does not expand institution abbreviations, nicknames, or aliases,
- treats person-like connections as coauthor-network search signals,
- ranks likely candidates by target-category match, author-position ownership likelihood, repeated recent activity, PI connection, exact institution evidence, and recency,
- returns one recent arXiv paper link for each candidate.

## What It Does Not Do

- no arXiv login,
- no automatic endorser eligibility check,
- no crawling of arXiv endorser-check pages,
- no batch access to `Which authors of this paper are endorsers?`,
- no arXiv search-page scraping,
- no PDF, source, or e-print crawling,
- no hidden email scraping,
- no automatic contact,
- no institution abbreviation expansion or fuzzy institution-name projection,
- no endorsement guarantee.

## Manual Check Workflow

For each candidate, open the listed arXiv paper. On the arXiv abstract page,
manually click:

```text
Which authors of this paper are endorsers?
```

arXivEndorserFinder only suggests ranked potential candidates. The final
endorsement eligibility decision must be confirmed manually by the user.
