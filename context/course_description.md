<!--
  Fed verbatim into every LLM generation call as background context.
  Keep it factual and course-specific — no fluff.
-->

# TIØ4145 — Corporate Finance

## What the course is
TIØ4145 Corporate Finance is a master's-level course at NTNU (Department of
Industrial Economics and Technology Management) taught by Maria Lavrutich.
It develops the modern theory of corporate financial decision-making and
applies it to real-world valuation, financing and investment problems.

The course is built around Berk & DeMarzo, *Corporate Finance*, and follows
the textbook's chapter structure closely. Lectures map onto specific chapter
ranges (e.g. chs. 1–5 and 7 in the introduction; chs. 9–10 for valuing
stocks; chs. 20–22 for options), so when generating notes for a section,
lean heavily on the corresponding chapters of the textbook for definitions,
notation, formulas and worked examples.

## Topics covered
1. **Foundations** — the corporation, financial statements, financial
   decision-making, the time value of money, and interest rates.
2. **Fixed income and capital budgeting** — bond pricing, YTM, the term
   structure, NPV and other investment decision rules.
3. **Equity valuation and pricing of risk** — DDM and other equity models,
   historical risk–return evidence, systematic vs. idiosyncratic risk.
4. **Portfolio theory and the CAPM** — diversification, the efficient
   frontier, derivation and use of the CAPM.
5. **Cost of capital and market efficiency** — estimating the cost of
   equity, the WACC, and the efficient markets hypothesis.
6. **Sustainable finance** — ESG, sustainability-linked instruments, and
   how climate and social factors enter valuation.
7. **Capital structure** — Modigliani–Miller, the debt tax shield, costs
   of financial distress, and the trade-off theory.
8. **Payout policy** — dividends vs. repurchases, payout irrelevance, and
   taxes/signalling/agency effects.
9. **Advanced valuation with leverage** — APV, WACC and FTE methods and
   their application to real corporate cases.
10. **Options** — financial options, put–call parity, binomial and
    Black–Scholes pricing.
11. **Real options** — applying option-pricing logic to investment timing,
    growth, abandonment and managerial flexibility under uncertainty.

## Audience and prerequisites
The course assumes prior exposure to financial mathematics, present-value
calculations, microeconomics and financial accounting — typically at the
level of TIØ4118 (Industrial Economic Analysis) and TIØ4105 (Business
Economics). Students are comfortable with algebra and basic probability;
formal proofs are not the focus, but derivations and quantitative reasoning
are. Most students are engineering majors specialising in industrial
economics, so a practical, application-oriented framing tends to land
better than a purely abstract one.

## Teaching approach
The course combines lectures, exercises, practical assignments and guest
lectures from industry professionals. Students work with real financial
data and spreadsheet-based analysis to apply theoretical concepts to
managerial problems. A recurring theme is the interaction between
investment decisions, financing decisions and risk. Exercises are
compulsory and must be approved to access the final exam.

## How to write content for this course
When generating section notes, flashcards or exam prep, follow these
principles:

- **Be precise with formulas.** Use Berk & DeMarzo notation (e.g. $r_E$,
  $r_D$, $r_{wacc}$, $\beta_i$, $E[R_i]$). Render math with LaTeX so it can
  be typeset with KaTeX/MathJax on the web page.
- **Show derivations, not just results.** Students benefit from seeing
  *why* CAPM, the MM propositions, APV ≡ WACC equivalence, put–call parity
  etc. hold — not just the final equation.
- **Anchor every concept in a worked numerical example.** This is an
  applied finance course; abstract definitions without numbers don't stick.
- **Flag exam-style framings.** The `resources/_exams/` folder contains
  exams from 2017–2024 plus separate multiple-choice components from
  2021/2023/2024. Where a topic has clearly recurred, point that out and
  mirror the question style.
- **Be honest about real-world caveats.** When a model has known empirical
  problems (CAPM beta instability, MM's unrealistic assumptions, EMH
  anomalies), say so — the course takes a critical, applied view.
- **Use English.** The course is taught in English; do not switch into
  Norwegian even though the institution is Norwegian.

## Out of scope
- Pure derivatives trading strategies (the options chapters cover pricing
  and corporate-finance use, not market-making).
- Personal finance, country-specific tax law, detailed IFRS/US-GAAP rules.
- Behavioural finance beyond the brief market-efficiency discussion.
