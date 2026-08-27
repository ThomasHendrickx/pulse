// How many rows the confirm screen previews. ONE definition, because the
// slice and the copy that discloses the slice used to be two unlinked
// literals: the number lived in the page component and the WORD "five"
// lived three times over in messages/{en,nl,fr}.json, so changing the
// slice left three translations asserting a count the screen no longer
// showed (finding CR-M3P3-04). The copy now interpolates this number
// instead of repeating it, and the truncation is disclosed rather than
// silent, which is the property that matters: a screen showing fewer rows
// than the document holds and saying nothing true about it has burned
// this project once.
export const PREVIEW_ROW_LIMIT = 5;
