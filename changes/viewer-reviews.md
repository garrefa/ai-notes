- Viewer: a **PR Reviews** view (glasses icon, right after Pull requests in the Library) lists the
  notes repo's `reviews/` folder, where `ainotes-review-notes` files one note per reviewed PR. A
  review is titled by its `# Review: repo#123 · …` heading, shows its latest verdict (Approved /
  Commented / Changes requested) as its status, is dated by its latest review so re-reviews come
  back up the list, and its excerpt is the review summary. Like the other note views it's hidden
  while empty and follows the tag and date filters.
- Viewer: a Library item added in a new version slots in after the item it follows by default,
  instead of at the bottom of a Library order you've customized.
- Viewer: HTML comments (such as a review's `<!-- review-history:end -->` marker) are no longer shown
  as text in a rendered note, and table rows and comments are never used as a note's excerpt.
