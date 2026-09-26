---
date: 2026-03-18
type: lecture
domain: [study]
epic: null
tags: [linear-algebra, lecture, math201]
status: n/a
links:
  - plans/2026-03-16-final-exams-study-plan.md
---

# MATH 201, lecture 14: eigenvalues and eigenvectors

First lecture of the spectral theory unit. It's likely on the final, so these notes need to be solid.

## Definitions

- **v** is an eigenvector of **A** with eigenvalue **λ** when **A v = λ v** and **v ≠ 0**.
- Eigenvalues are the roots of the characteristic polynomial: **det(A − λI) = 0**.

## Worked example

For A = [[2, 1], [1, 2]]:

1. det(A − λI) = (2 − λ)² − 1 = λ² − 4λ + 3 = (λ − 1)(λ − 3)
2. λ = 1 → v = (1, −1); λ = 3 → v = (1, 1)

## Things the professor stressed

- The sum of the eigenvalues is the **trace**; their product is the **determinant**. Quick sanity check
  on exams.
- A symmetric matrix always has real eigenvalues and orthogonal eigenvectors (spectral theorem, next
  lecture).

## To review

- [ ] Problem set 6, questions 3 to 7
- [ ] Watch the 3Blue1Brown video on eigenvectors again
