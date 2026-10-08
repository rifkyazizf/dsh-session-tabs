/**
 * Session tab strip policy — the single source of truth for which sessions are
 * on the strip and which tab a new session replaces.
 *
 * This module is plain ESM with no imports so both halves of the plugin can use
 * it: `lib/client.js` inlines it at bundle build time (a browser half is a
 * `window.__ModuleLoader__` bundle that may require only the shell seeds
 * `react` and `react/jsx-runtime`), and `verify.mjs` imports it under Node.
 * Keeping one copy means the verified policy is literally the shipped policy.
 *
 * ## The rule
 *
 * This is JetBrains' editor-tab behaviour, with sessions in the role of files:
 *
 * - A tab you have **worked in** stays. For a session, "worked in" is exactly
 *   "you sent a message in it", which the session list already reports as
 *   `blank === false`. The host owns that bit and stamps it on the first
 *   accepted prompt (`promptAttempted`), and its reducer refuses to re-blank a
 *   session afterwards — so the quality is sticky in the way the request needs,
 *   with no bookkeeping here.
 * - A tab you have only **opened** is disposable. Opening another session
 *   reuses that one untouched tab rather than growing the strip.
 *
 * So the strip is: every visited session that has been engaged, plus at most
 * one untouched "preview" tab holding whichever unengaged session you looked at
 * last. That is what stops an exploratory click through the sidebar from
 * leaving a trail of tabs. Nothing is dropped for being old — the row scrolls.
 *
 * ## Ordering
 *
 * Engaged tabs keep the order they were first engaged in, so a strip you have
 * been working in does not reshuffle under the pointer when you revisit an old
 * tab. The preview tab always sits last, because it is the one that will be
 * replaced.
 *
 * ## Memory
 *
 * `deriveTabs` returns the **whole** engagement order (`engaged`), and the caller
 * stores all of it as the next `order`. Remembering only the tabs that happened
 * to be on screen is not stable: with more engaged sessions than the row shows,
 * each render derives a window from the truncated memory, stores that window, and
 * the next render derives the next window from it — the strip rotates under the
 * pointer on every re-render (typing re-renders it).
 */

/**
 * Whether a session counts as engaged — a tab that must survive.
 *
 * Delegated to the host's `blank` bit rather than tracked locally: a message
 * sent, a queued prompt, or a run started all clear it, and the host is the only
 * party that sees every one of those. `undefined` is treated as blank, so a
 * session whose summary has not arrived yet cannot pin itself by accident.
 *
 * @param summary - a session list row, or undefined.
 * @returns true when the session has been engaged and its tab must stick.
 */
export function isEngaged(summary) {
	if (summary === undefined || summary === null) return false;
	return summary.blank === false;
}

/**
 * Whether a session can appear on the strip at all.
 *
 * Subagent children are excluded: they are reached through their parent's
 * breadcrumb, not by switching the whole conversation, so a tab for one would
 * lie about what the strip does. Archived rows are excluded by their absence
 * from the caller's list rather than here.
 *
 * @param summary - a session list row, or undefined.
 * @returns true when the session is a top-level session.
 */
export function isTabCandidate(summary) {
	if (summary === undefined || summary === null) return false;
	return summary.origin !== "subagent";
}

/**
 * Derive the strip: the tabs to show, in order, which one is the disposable
 * preview, and the full engagement order for the caller to remember.
 *
 * @param input - the session list, the previously known order, and the current selection.
 * @returns the ordered tab ids, the preview id if any, and the whole engagement
 * order (the caller's next `order`, never a truncated window).
 */
export function deriveTabs(input) {
	const ids = input.ids ?? [];
	const byId = input.byId ?? {};
	const current = input.current;
	const previous = input.order ?? [];

	const engaged = [];
	const seen = new Set();
	/* Keep the caller's remembered order first, so revisiting an old tab does
	 * not move it; then append anything newly engaged in list order. */
	for (const id of previous) {
		const summary = byId[id];
		if (seen.has(id) || !isTabCandidate(summary) || !isEngaged(summary)) continue;
		seen.add(id);
		engaged.push(id);
	}
	for (const id of ids) {
		const summary = byId[id];
		if (seen.has(id) || !isTabCandidate(summary) || !isEngaged(summary)) continue;
		seen.add(id);
		engaged.push(id);
	}

	/* The preview is the current session when it is not already engaged: the one
	 * untouched tab the strip is willing to lose. */
	const currentSummary = current === undefined ? undefined : byId[current];
	const preview = isTabCandidate(currentSummary) && !isEngaged(currentSummary) ? current : undefined;

	return {
		ids: preview === undefined ? engaged : [...engaged, preview],
		preview,
		/* The full order, not the on-screen window: see the Memory note above. */
		engaged
	};
}

/**
 * One strip step: derive the tabs from the remembered order, and report the order
 * to remember next.
 *
 * The component calls exactly this, and keeps `order` verbatim. That is the whole
 * fix for the rotating strip: the memory is the full engagement order
 * ({@link deriveTabs} returns it), never the window that happened to be rendered.
 *
 * @param input - as {@link deriveTabs}.
 * @returns the derived strip plus `order`, the next call's `input.order`.
 */
export function stepTabs(input) {
	const derived = deriveTabs(input);
	return {
		ids: derived.ids,
		preview: derived.preview,
		order: derived.engaged
	};
}

/**
 * Shorten a session title to a fixed character budget — the label a chip wears
 * *before* it has been laid out.
 *
 * This is the fallback, not the fit. {@link fitLabel} cuts to the pixel width
 * the chip's label slot actually has, which is the behaviour the user sees; this
 * one only has to be safe: it bounds the text the first render puts in the DOM
 * (a 500-character title never lands there), it stands in when there is nothing
 * to measure, and its ellipsis means the span's own `text-overflow` can never be
 * reached with the budget as the binding constraint.
 *
 * Words are preferred over characters: the cut lands on the last whole word that
 * fits when one is reasonably close to the limit.
 *
 * @param title - the session's display title.
 * @param budget - maximum characters, before the ellipsis.
 * @returns the shortened title, unchanged when it already fits.
 */
export function chipLabel(title, budget = 18) {
	const text = typeof title === "string" ? title : "";
	const trimmed = text.trim();
	if (trimmed.length <= budget) return trimmed;
	const clipped = trimmed.slice(0, budget);
	/* Prefer a word boundary, but only when it does not throw away most of the
	 * budget: "Add DeepSeek peak/off-peak" should not become "Add". */
	const lastSpace = clipped.lastIndexOf(" ");
	const cut = lastSpace >= Math.floor(budget * 0.6) ? clipped.slice(0, lastSpace) : clipped;
	return `${cut.trimEnd()}…`;
}

/**
 * Split text into user-perceived characters.
 *
 * A cut made by code unit can land inside a surrogate pair or an emoji ZWJ
 * sequence and leave a replacement box at the end of the label. `Intl.Segmenter`
 * is the accurate path; `Array.from` (code points) is the fallback for an engine
 * without it.
 *
 * @param text - the string to split.
 * @returns its graphemes, in order.
 */
export function graphemes(text) {
	const value = typeof text === "string" ? text : "";
	if (value === "") return [];
	const Segmenter = globalThis.Intl?.Segmenter;
	if (typeof Segmenter === "function") {
		const segmenter = new Segmenter(void 0, { granularity: "grapheme" });
		return Array.from(segmenter.segment(value), (part) => part.segment);
	}
	return Array.from(value);
}

/**
 * Fit a title to the pixel width a chip's label slot actually has.
 *
 * The chip is a fixed 190px box, so its label slot is a fixed *pixel* budget
 * (~141px: the box less its padding, the state dot, and the reserved close
 * slot). A character budget cannot know that: the same 18 characters are 86px in
 * one title and 200px in another, so a character-capped label leaves most of the
 * slot empty ("Penalizing…" in a slot with room for "Penalizing Chinese mode").
 * This fits by measurement instead, which is also what makes the label track a
 * changed shell font rather than guessing at it.
 *
 * The cut itself stays word-shaped where that is free: a one-character orphan at
 * the edge ("Penalizing Chinese m…") reads as a typo, so it is dropped in favour
 * of the space. Anything longer stays and spends the slot — backing off from a
 * whole word is how a 141px slot ends up 20% empty, which is the thing being
 * fixed here.
 *
 * @param title - the session's display title.
 * @param available - the label slot's width in px.
 * @param measure - `(text) => px` for the font the label is rendered in.
 * @param options - `ellipsis` (default `"…"`) and `maxStub` (default 1 grapheme:
 * the longest chopped tail worth discarding instead of printing).
 * @returns the fitted label; the whole title when it fits or when nothing can be
 * measured (the span's own `text-overflow` then clips it).
 */
export function fitLabel(title, available, measure, options = {}) {
	const text = typeof title === "string" ? title.trim() : "";
	if (text === "") return "";
	/* No measurement (first paint before layout, a test stub, a collapsed slot):
	 * hand back the whole title rather than a guess — the span clips it. */
	if (typeof measure !== "function" || !(available > 0)) return text;
	const ellipsis = typeof options.ellipsis === "string" && options.ellipsis !== "" ? options.ellipsis : "…";
	const maxStub = Number.isFinite(options.maxStub) ? Math.max(0, Math.floor(options.maxStub)) : 1;
	if (measure(text) <= available) return text;
	const room = available - measure(ellipsis);
	if (!(room > 0)) return "";
	const chars = graphemes(text);
	/* A prefix that fits is monotone in its length, so bisect: a long title costs
	 * ~8 measurements instead of one per character. */
	let low = 0;
	let high = chars.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (measure(chars.slice(0, middle).join("")) <= room) low = middle;
		else high = middle - 1;
	}
	let cut = chars.slice(0, low).join("").trimEnd();
	/* Only a cut *inside* a word needs the back-off. One that already ends on a
	 * space is word-shaped, and the space before it belongs to the next word — so
	 * the stub is the run of characters after the last space of the untrimmed
	 * prefix, which is the word being chopped. */
	if (low < chars.length && chars[low] !== " ") {
		const space = chars.slice(0, low).join("").lastIndexOf(" ");
		if (space > 0 && low - space - 1 <= maxStub) cut = chars.slice(0, space).join("").trimEnd();
	}
	return cut === "" ? "" : `${cut}${ellipsis}`;
}

/**
 * The tabs a bulk close removes, by side.
 *
 * The right-clicked tab is never in the result: "close all left" leaves it and
 * everything before it alone, "close all right" everything after it, and "close all
 * others" exactly it. Order is preserved so the caller can dismiss in strip order.
 *
 * @param tabs - the strip in display order, as `{ id }` rows.
 * @param id - the tab that was right-clicked.
 * @param side - `"left"`, `"right"`, or `"others"`.
 * @returns the ids to dismiss (empty when the tab is not on the strip).
 */
export function closeRangeIds(tabs, id, side) {
	const index = tabs.findIndex((tab) => tab.id === id);
	if (index < 0) return [];
	const doomed = side === "left" ? tabs.slice(0, index) : side === "right" ? tabs.slice(index + 1) : tabs.filter((tab) => tab.id !== id);
	return doomed.map((tab) => tab.id);
}

/**
 * Which bulk closes apply to the tab at `index`.
 *
 * A row that cannot do anything is shown disabled rather than hidden, so the menu
 * keeps the same shape wherever it is opened.
 *
 * @param count - tabs on the strip.
 * @param index - the right-clicked tab's position, or -1 when it is unknown.
 * @returns whether each bulk close has anything to do.
 */
export function closeRangeAvailability(count, index) {
	return {
		left: index > 0,
		right: index >= 0 && index < count - 1,
		others: count > 1
	};
}

/**
 * Which tab a navigation should replace, if any.
 *
 * The whole point of the feature: opening a session reuses the existing
 * untouched tab instead of adding one. Returns `undefined` when the target is
 * already on the strip (that tab is simply focused) or when there is no
 * disposable tab to reuse.
 *
 * @param target - the session being opened.
 * @param tabs - the strip as {@link deriveTabs} returned it.
 * @returns the preview tab id to replace, or undefined to open a new tab.
 */
export function tabToReplace(target, tabs) {
	if (target === undefined || tabs === undefined) return undefined;
	if (tabs.ids.includes(target)) return undefined;
	return tabs.preview;
}
