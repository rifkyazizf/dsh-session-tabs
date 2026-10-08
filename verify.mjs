// Policy + wiring self-check for the DSH session tab strip.
//
//   node ~/.dsh/plugins/dsh-session-tabs/verify.mjs
//
// Three layers, in order:
//
//   1. policy.js  — the recycle rule, asserted on hand-built session lists.
//   2. client.js  — the bundle contract: loads, exports apply/inject, requires
//                   only the shell seeds, registers the dock seat, and inlines
//                   policy.js faithfully.
//   3. rendered   — the real component against stubbed react, including the
//                   chips a user reads and the close control.
//
// The rule under test: a session you sent a message in keeps its tab (the host
// reports that as `blank === false`); a session you merely opened is one
// disposable preview tab that the next open replaces.
import { fileURLToPath, pathToFileURL } from "node:url";

import * as policy from "./lib/policy.js";

const BUNDLE = fileURLToPath(new URL("./lib/client.js", import.meta.url));
const EXPECTED_ID = "dsh-session-tabs";
/** The seat the strip claims: a list seat, so it takes a fresh id beside the todo and queue docks. */
const DOCK_SLOT = "conversation.input.dock";
/** This plugin's id inside that list seat. */
const DOCK_ID = "session-tabs";

let captured;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			captured = definition;
		}
	}
};

await import(pathToFileURL(BUNDLE).href);

const fail = (message) => {
	console.error(`FAIL: ${message}`);
	process.exitCode = 1;
};
const assert = (condition, message) => {
	if (!condition) fail(message);
};
const assertEqual = (actual, expected, message) => {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	assert(a === b, `${message}: got ${a}, expected ${b}`);
};

const { deriveTabs, stepTabs, closeRangeIds, closeRangeAvailability, chipLabel, fitLabel, graphemes, isEngaged, isTabCandidate } = policy;

// ---- fixtures ----
/** One session-list row. `engaged` is the inverse of the host's `blank` bit. */
const row = (id, engaged, extra = {}) => ({
	id,
	blank: !engaged,
	displayTitle: extra.displayTitle ?? id,
	running: extra.running ?? false,
	...extra.origin === void 0 ? {} : { origin: extra.origin }
});
/** A session list snapshot from rows plus the current selection. */
const list = (rows, current) => ({
	ids: rows.map((r) => r.id),
	byId: Object.fromEntries(rows.map((r) => [r.id, r])),
	current
});

// ---- 1. the recycle rule ----
// This is the whole feature: browsing sessions that were never engaged leaves
// exactly one tab behind, wherever the browsing ends up.
{
	const sessions = list([row("a", false), row("b", false), row("c", false)], "a");
	let tabs = deriveTabs({ ...sessions, order: [] });
	assertEqual(tabs.ids, ["a"], "opening a fresh session shows one tab");
	assertEqual(tabs.preview, "a", "the untouched tab is the preview");

	// Walk the list the way a user clicking through the sidebar would.
	for (const id of ["b", "c", "a", "c"]) {
		const current = list([row("a", false), row("b", false), row("c", false)], id);
		tabs = deriveTabs({ ...current, order: tabs.ids });
		assertEqual(tabs.ids, [id], `browsing to ${id} still shows exactly one tab`);
		assertEqual(tabs.preview, id, `browsing to ${id} leaves it as the preview`);
	}
}

// Once a session is engaged its tab sticks, and the preview moves on.
{
	let tabs = deriveTabs({ ...list([row("a", false), row("b", true), row("c", false)], "b"), order: [] });
	assertEqual(tabs.ids, ["b"], "the engaged session has a tab");
	assertEqual(tabs.preview, undefined, "an engaged session is not a preview");

	tabs = deriveTabs({ ...list([row("a", false), row("b", true), row("c", false)], "c"), order: tabs.ids });
	assertEqual(tabs.ids, ["b", "c"], "opening c adds a preview beside engaged b");
	assertEqual(tabs.preview, "c", "c is the new preview");

	// Sending a message in c promotes it: the preview becomes an ordinary tab.
	tabs = deriveTabs({ ...list([row("a", false), row("b", true), row("c", true)], "c"), order: tabs.ids });
	assertEqual(tabs.ids, ["b", "c"], "engaging c keeps both tabs");
	assertEqual(tabs.preview, undefined, "nothing is disposable once c is engaged");
}

// Two engaged sessions plus a third browse: still exactly three, no trail.
{
	const rows = [row("a", true), row("b", true), row("c", false), row("d", false)];
	let tabs = deriveTabs({ ...list(rows, "a"), order: [] });
	tabs = deriveTabs({ ...list(rows, "c"), order: tabs.ids });
	assertEqual(tabs.ids, ["a", "b", "c"], "a browse adds one preview to two engaged tabs");
	tabs = deriveTabs({ ...list(rows, "d"), order: tabs.ids });
	assertEqual(tabs.ids, ["a", "b", "d"], "the next browse replaces the preview, not an engaged tab");
	assertEqual(tabs.preview, "d", "the newest browse is the preview");
}

// Engaged tabs keep the order they were engaged in.
{
	const rows = [row("a", true), row("b", true), row("c", true)];
	const tabs = deriveTabs({ ...list(rows, "a"), order: ["b", "c", "a"] });
	assertEqual(tabs.ids, ["b", "c", "a"], "revisiting an old tab does not reshuffle the strip");
	// And with no remembered order, list order is the fallback.
	assertEqual(deriveTabs({ ...list(rows, "b"), order: [] }).ids, ["a", "b", "c"], "list order is the fallback");
}

// Subagent sessions are not tabs.
{
	const tabs = deriveTabs({
		...list([row("a", true), row("sub", true, { origin: "subagent" })], "a"),
		order: []
	});
	assertEqual(tabs.ids, ["a"], "a subagent session is excluded from the strip");
	assert(!isTabCandidate(row("sub", true, { origin: "subagent" })), "isTabCandidate rejects a subagent");
	assert(isTabCandidate(row("a", true)), "isTabCandidate accepts a top-level session");
}

// The preview is only ever the current session: a stale unengaged row cannot
// become the replace target while you are looking at something else.
{
	const sessions = list([row("a", true), row("b", false)], "a");
	const tabs = deriveTabs({ ...sessions, order: [] });
	assertEqual(tabs.preview, undefined, "an unengaged row that is not current is not the preview");
	assertEqual(tabs.ids, ["a"], "the unengaged non-current row stays off the strip");
}

// Long strips: every engaged tab is kept, and the order is a fixed point.
// Dropping tabs to a fixed window is what made the strip rotate on every render
// — the window was the memory, so each render derived its window from the last
// one. The strip scrolls now, and the memory is the whole engagement order.
{
	const ids = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, "0")}`);
	const rows = ids.map((id) => row(id, true));
	const tabs = deriveTabs({ ...list(rows, ids[0]), order: [] });
	assertEqual(tabs.ids, ids, "an engaged tab must never be dropped for being old");
	assertEqual(tabs.engaged, ids, "the memory must be the whole engagement order");
	// With a preview the engaged set is untouched and the preview sits last.
	const withPreview = deriveTabs({ ...list([...rows, row("p", false)], "p"), order: [] });
	assertEqual(withPreview.ids.length, ids.length + 1, "the preview joins without evicting an engaged tab");
	assertEqual(withPreview.ids.at(-1), "p", "the preview stays last");
	assertEqual(withPreview.preview, "p", "the preview is still the current unengaged session");
}

// Replaying the component's own loop must not move the strip. `stepTabs` is what
// the component calls and what it stores, so this loop is the real re-render
// sequence, not a proxy for it: one distinct result, not a rotation.
{
	const ids = "abcdefghij".split("");
	const byId = Object.fromEntries(ids.map((id) => [id, row(id, true)]));
	const shown = new Set();
	let order = [];
	for (let render = 0; render < 8; render += 1) {
		const derived = stepTabs({ ids, byId, current: "j", order });
		shown.add(JSON.stringify(derived.ids));
		order = derived.order;
	}
	assertEqual(shown.size, 1, "the strip rotates on re-render — the memory is not a fixed point");
}

// The blank bit's meaning, asserted directly.
assert(isEngaged(row("a", true)), "blank=false is engaged");
assert(!isEngaged(row("a", false)), "blank=true is not engaged");
assert(!isEngaged(undefined), "a missing summary is not engaged");
assert(!isTabCandidate(undefined), "a missing summary is not a candidate");

// ---- 2. chip labels ----
{
	const cases = [
		["Fix the login bug", "Fix the login bug"],
		["Short", "Short"],
		["   padded   ", "padded"],
		["Add DeepSeek peak/off-peak session tabs", "Add DeepSeek…"],
		["a_very_long_single_token_filename", "a_very_long_single…"],
		["", ""]
	];
	for (const [input, expected] of cases) {
		assertEqual(chipLabel(input), expected, `chipLabel(${JSON.stringify(input)})`);
	}
	// Every label fits the budget, ellipsis included.
	for (const [input] of cases) {
		assert(chipLabel(input).length <= 19, `chipLabel(${JSON.stringify(input)}) overran the budget`);
	}
	// A short budget still yields whole words rather than a chopped token.
	assertEqual(chipLabel("Fix the login bug", 6), "Fix…", "a short budget drops the partial word instead of emitting it");
	assertEqual(chipLabel(undefined), "", "chipLabel tolerates a missing title");
}

// ---- 2a. fitted chip labels ----
// The label a chip *wears* is fitted to the slot's real pixel width, not to a
// character count. The measurer is injected, so this stays deterministic: a
// uniform 7px per character makes a 141px slot hold ~19 characters.
{
	const perChar = (text) => text.length * 7;
	const title = "Penalizing Chinese model overthinking via prompts";
	const sidebar = "Sidebar menu spacing like Claude Code";

	// A title that fits is handed back untouched — no ellipsis to explain.
	assertEqual(fitLabel("Fix the login bug", 141, perChar), "Fix the login bug", "a title that fits must not be touched");
	assertEqual(fitLabel("   padded   ", 141, perChar), "padded", "a fitted label is trimmed");
	assertEqual(fitLabel("", 141, perChar), "", "an empty title stays empty");
	assertEqual(fitLabel(undefined, 141, perChar), "", "a missing title stays empty");

	// The slot less the ellipsis is the room the cut fills, and it lands after the
	// last whole word that fits — so the chip shows more than the old budget did.
	assertEqual(fitLabel(title, 141, perChar), "Penalizing Chinese…", "the fit must keep every whole word that fits");
	assert(fitLabel(title, 141, perChar).length > chipLabel(title).length, "the pixel fit must show more of the title than the character budget did");

	// A one-character stub is not worth printing: "Sidebar menu s…" reads worse
	// than "Sidebar menu…", and the stub is one character of the slot.
	assertEqual(fitLabel(sidebar, 108, perChar), "Sidebar menu…", "a one-character stub must be dropped, not printed");
	assertEqual(fitLabel(sidebar, 108, perChar, { maxStub: 0 }), "Sidebar menu s…", "maxStub=0 keeps the stub and spends the slot");
	// A two-character tail is not an orphan: the default keeps it and fills the
	// slot. `maxStub: 3` would prefer the whole word and leave the slot empty —
	// eleven characters of it, measured here.
	assertEqual(fitLabel("Add DeepSeek peak/off-peak session tabs", 213, perChar), "Add DeepSeek peak/off-peak se…", "the default must discard only a one-character orphan");
	assertEqual(fitLabel("Add DeepSeek peak/off-peak session tabs", 213, perChar, { maxStub: 3 }), "Add DeepSeek peak/off-peak…", "a larger maxStub trades the slot for a whole word");

	// A long token with no space to back off to still fills the slot, and the
	// ellipsis counts against the room whatever it is spelled.
	assertEqual(fitLabel("a_very_long_single_token_filename", 60, perChar), "a_very_…", "an unbroken token is cut at the pixel edge");
	// A three-dot ellipsis costs 21px of the synthetic room, so two fewer characters fit.
	assertEqual(fitLabel("a_very_long_single_token_filename", 60, perChar, { ellipsis: "..." }), "a_ver...", "the ellipsis is measured, not assumed");

	// Measurement is a prediction, not a guarantee: with nothing to measure, the
	// whole title goes to the span and its own `text-overflow` clips it.
	assertEqual(fitLabel(title, 141, undefined), title, "no measurer must yield the whole title");
	assertEqual(fitLabel(title, 0, perChar), title, "a zero-width slot must yield the whole title");
	assertEqual(fitLabel(title, NaN, perChar), title, "an unmeasurable slot must yield the whole title");
	assertEqual(fitLabel(title, 5, perChar), "", "a slot narrower than the ellipsis itself shows nothing");
}

// Cuts are made in graphemes, so an emoji never loses half of itself.
{
	assertEqual(graphemes("ab"), ["a", "b"], "plain text splits per character");
	assertEqual(graphemes(""), [], "an empty string has no graphemes");
	assertEqual(graphemes(undefined), [], "a missing string has no graphemes");
	assertEqual(graphemes("e\u0301"), ["e\u0301"], "a combining mark stays with its letter");
	assertEqual(graphemes("👍🏽").length, 1, "a skin-toned emoji is one grapheme, not four code units");
	const emoji = "Ship it 👍🏽👍🏽👍🏽👍🏽";
	const count = (text) => graphemes(text).length * 7;
	assertEqual(fitLabel(emoji, 74, count, { maxStub: 0 }), "Ship it 👍🏽…", "an emoji at the cut must survive whole");
}

// ---- 2b. the inlined copy matches the tested one ----
assert(captured !== undefined, "bundle did not call window.__ModuleLoader__.load");
assertEqual(captured.id, EXPECTED_ID, "bundle id");
assert(typeof captured.factory === "function", "bundle has no factory");

const calls = [];
/** Every value handed to a state setter by the bundle under test. */
const stateWrites = [];
/*
 * Ref persistence, opt-in per test. By default `useRef` hands back a fresh box, so
 * each `Component(...)` call is a first render. `beginRender()` switches to a
 * registry whose boxes are keyed by hook order and reused across calls, which lets
 * a test drive the *same* component instance through two renders — the only way to
 * observe state a ref carries between them (the dismissal set, the order memory).
 * `endRender()` restores the default.
 */
let persistentRefs = null;
let persistentRefIndex = 0;
const beginRender = () => {
	if (persistentRefs === null) persistentRefs = [];
	persistentRefIndex = 0;
};
const endRender = () => {
	persistentRefs = null;
	persistentRefIndex = 0;
};
const fakeRequire = (id) => {
	calls.push(id);
	if (id === "react") {
		return {
			useState: (initial) => [typeof initial === "function" ? initial() : initial, (value) => {
				stateWrites.push(value);
			}],
			// Run effect callbacks the way React would after a render; cleanups are
			// ignored, since the suite never unmounts a component.
			useEffect: (callback) => {
				callback();
			},
			// The chip's label fit runs in a layout effect, which React runs before paint
			// and this stub runs just as eagerly. No stub assigns a ref, so the fit finds
			// no node and the chip keeps `props.label` — the fallback the rendered
			// assertions below pin. `fitLabel` itself is covered directly, and the canvas
			// seam by `nodeMeasurer` below.
			useLayoutEffect: (callback) => {
				callback();
			},
			useRef: (initial) => {
				if (persistentRefs === null) return { current: initial };
				const index = persistentRefIndex;
				persistentRefIndex += 1;
				if (persistentRefs[index] === void 0) persistentRefs[index] = { current: initial };
				return persistentRefs[index];
			}
		};
	}
	if (id === "react/jsx-runtime") {
		return {
			jsx: (type, props) => ({ type, props }),
			jsxs: (type, props) => ({ type, props })
		};
	}
	// `react-dom` is a platform seed word too (the shell's staticModules table);
	// the strip uses `createPortal` to render into the row it anchors under the
	// conversation header, and again for its context menu.
	if (id === "react-dom") {
		return {
			createPortal: (children, container) => ({ type: "portal", props: { children, container } })
		};
	}
	// The shell's UI primitives (another seed word): the menu material, its rows, and
	// the icon on the rename row.
	if (id === "@deepseek-ai/dsh-client-ui-primitives") {
		return {
			MenuSurface: (props) => ({ type: "menu-surface", props }),
			MenuItemButton: (props) => ({ type: "menu-item", props }),
			IconEditOutlineRegular: (props) => ({ type: "icon-edit", props })
		};
	}
	throw new Error(`unexpected require("${id}") in the client bundle`);
};

const exports_ = captured.factory(fakeRequire);
assert(typeof exports_.apply === "function", "client half exports no apply()");
assert(Array.isArray(exports_.inject) && exports_.inject.includes("slots"), "client half does not inject the slots service");
assert(exports_.inject.includes("sessions"), "client half does not inject the sessions service");
const SHELL_SEEDS = ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/dsh-client-ui-primitives"];
assert(
	calls.every((id) => SHELL_SEEDS.includes(id)),
	`bundle requires modules outside the shell seed set: ${JSON.stringify(calls)}`
);

const { anchorStripHost } = exports_.__internals;
const inline = exports_.__internals;
// The inline must agree with policy.js on the whole derivation, not just the
// constants: run every fixture shape through both and compare.
const parityStrip = ["a", "b", "c"].map((id) => ({ id }));
const derivedCount = (input) => (input.ids ?? []).length;
const parityInputs = [
	{ ...list([row("a", false), row("b", false), row("c", false)], "a"), order: [] },
	{ ...list([row("a", false), row("b", true), row("c", false)], "c"), order: ["b"] },
	{ ...list([row("a", true), row("b", true), row("c", true)], "a"), order: ["b", "c", "a"] },
	{ ...list([row("a", true), row("x", true, { origin: "subagent" })], "a"), order: [] },
	{ ...list(Array.from({ length: 12 }, (_, i) => row(`s${i}`, true)), "s0"), order: [] },
	{ ...list([row("a", true), row("p", false)], "p"), order: ["a"] }
];
for (const input of parityInputs) {
	assertEqual(inline.deriveTabs(input), deriveTabs(input), `inlined deriveTabs parity for current=${input.current}`);
	assertEqual(inline.deriveTabs(input).engaged, deriveTabs(input).engaged, `inlined engagement-order parity for current=${input.current}`);
	assertEqual(inline.stepTabs(input), stepTabs(input), `inlined stepTabs parity for current=${input.current}`);
	assertEqual(inline.closeRangeAvailability(derivedCount(input), 1), closeRangeAvailability(derivedCount(input), 1), "inlined closeRangeAvailability parity");
	assertEqual(inline.closeRangeIds(parityStrip, "b", "others"), closeRangeIds(parityStrip, "b", "others"), "inlined closeRangeIds parity");
}
for (const title of ["", "Short", "Add DeepSeek peak/off-peak session tabs", "a_very_long_single_token_filename"]) {
	assertEqual(inline.chipLabel(title), chipLabel(title), `inlined chipLabel parity for ${JSON.stringify(title)}`);
}
{
	// The fitted label is inlined too, so it is held to the same standard: same
	// answer as policy.js on every fixture, widths on both sides of every edge.
	const perChar = (text) => text.length * 7;
	const cases = [
		["", 141],
		["Short", 141],
		["Add DeepSeek peak/off-peak session tabs", 141],
		["a_very_long_single_token_filename", 60],
		["a_very_long_single_token_filename", 8],
		["Penalizing Chinese model overthinking via prompts", 141],
		["Sidebar menu spacing like Claude Code", 108],
		["Ship it 👍🏽👍🏽👍🏽👍🏽", 74],
		["Fix the login bug", 0]
	];
	for (const [title, width] of cases) {
		assertEqual(inline.fitLabel(title, width, perChar), fitLabel(title, width, perChar), `inlined fitLabel parity for ${JSON.stringify(title)} @${width}px`);
		assertEqual(inline.fitLabel(title, width, perChar, { maxStub: 0 }), fitLabel(title, width, perChar, { maxStub: 0 }), `inlined fitLabel options parity for ${JSON.stringify(title)} @${width}px`);
	}
	assertEqual(inline.graphemes("a👍🏽b"), graphemes("a👍🏽b"), "inlined graphemes parity");
	assertEqual(inline.graphemes(void 0), graphemes(void 0), "inlined graphemes parity for a missing string");
}

// ---- 2c0. the canvas measurer ----
// The measurer the chip fits against reads the *rendered* font off the label node
// and measures with a canvas, so a shell or a sibling plugin that changes the
// family, size, or spacing moves the cut with it. Every part of that is stubbed
// here; what is under test is that the seam carries the font through and that it
// degrades to `undefined` — never a throw — when there is nothing to measure.
{
	const { nodeMeasurer, LABEL_SAFETY } = inline;
	const styled = { fontStyle: "normal", fontWeight: "600", fontSize: "12px", fontFamily: "Test Sans", letterSpacing: "0.5px" };
	const seen = [];
	const context = {
		font: "",
		letterSpacing: "",
		measureText(text) {
			seen.push([context.font, text]);
			return { width: text.length * 7 };
		}
	};
	globalThis.document = { createElement: () => ({ getContext: (kind) => (kind === "2d" ? context : null) }) };
	globalThis.getComputedStyle = (node) => (node === "label" ? styled : null);

	const measure = nodeMeasurer("label");
	assert(typeof measure === "function", "a laid-out label must yield a measurer");
	assertEqual(context.letterSpacing, "0.5px", "the measurer must carry the node's letter spacing");
	assertEqual(measure("abcd"), 28, "the measurer must return the canvas width");
	assertEqual(seen[seen.length - 1][0], "normal 600 12px Test Sans", "the measurer must measure in the node's rendered font");
	assertEqual(seen[seen.length - 1][1], "abcd", "the measurer must measure the string it was handed");
	assertEqual(nodeMeasurer("other"), void 0, "a node with no computed style has no measurer");
	assertEqual(LABEL_SAFETY, 1, "the fit must keep a pixel of slack so the span's own clip is never the binding cut");

	// A fake node has no canvas and no computed style: undefined, not a throw. The
	// chip then keeps `chipLabel`, and the span's `text-overflow` clips as before.
	delete globalThis.document;
	assertEqual(nodeMeasurer("label"), void 0, "a document with no canvas must not throw");
	delete globalThis.getComputedStyle;
	assertEqual(nodeMeasurer("label"), void 0, "a missing getComputedStyle must not throw");
}
assertEqual(inline.isEngaged(row("a", true)), isEngaged(row("a", true)), "inlined isEngaged parity");

// ---- 2c. wheel mapping ----
// A plain wheel over the strip scrolls it sideways; a horizontal gesture keeps
// its own delta; nothing at all — or a strip with no overflow — stays 0 so the
// transcript keeps the event.
{
	const { scrollStep } = inline;
	assertEqual(scrollStep({ deltaX: 0, deltaY: 120 }, true), 120, "a vertical wheel must move the strip sideways");
	assertEqual(scrollStep({ deltaX: -50, deltaY: 4 }, true), -50, "a horizontal gesture keeps its own delta");
	assertEqual(scrollStep({ deltaX: 0, deltaY: 120 }, false), 0, "a strip with no overflow must not swallow the wheel");
	assertEqual(scrollStep({ deltaX: 0, deltaY: 0 }, true), 0, "a wheel event that moves nothing stays 0");
	assertEqual(scrollStep({}, true), 0, "a partial wheel event must not produce NaN");
}

// ---- 2b2. bulk closes ----
// "Close all left/right/others" from a tab's context menu: which tabs go, and which
// rows are live. The right-clicked tab is never closed by any of them.
{
	const strip = ["a", "b", "c", "d"].map((id) => ({ id }));
	assertEqual(closeRangeIds(strip, "c", "left"), ["a", "b"], "close-left must take only the tabs before it");
	assertEqual(closeRangeIds(strip, "c", "right"), ["d"], "close-right must take only the tabs after it");
	assertEqual(closeRangeIds(strip, "c", "others"), ["a", "b", "d"], "close-others must take every other tab, in strip order");
	assertEqual(closeRangeIds(strip, "a", "left"), [], "the first tab has nothing to its left");
	assertEqual(closeRangeIds(strip, "a", "right"), ["b", "c", "d"], "the first tab still closes everything to its right");
	assertEqual(closeRangeIds(strip, "a", "others"), ["b", "c", "d"], "close-others on the first tab takes the rest");
	assertEqual(closeRangeIds(strip, "d", "right"), [], "the last tab has nothing to its right");
	assertEqual(closeRangeIds(strip, "missing", "others"), [], "a tab that is not on the strip closes nothing");
	assertEqual(closeRangeIds([{ id: "a" }], "a", "others"), [], "a lone tab has no others to close");

	assertEqual(closeRangeAvailability(4, 0), { left: false, right: true, others: true }, "the first of four closes right and others");
	assertEqual(closeRangeAvailability(4, 3), { left: true, right: false, others: true }, "the last of four closes left and others");
	assertEqual(closeRangeAvailability(4, 1), { left: true, right: true, others: true }, "a middle tab closes on every side");
	assertEqual(closeRangeAvailability(1, 0), { left: false, right: false, others: false }, "a lone tab closes nothing");
	assertEqual(closeRangeAvailability(4, -1), { left: false, right: false, others: true }, "an unknown position only leaves close-others live");
}

// ---- 2c2. persisted memory ----
// Dismissals and the engagement order outlive the window: the shell reloads its page
// when the app restarts, so memory that only lives in the page module dies exactly
// when a user expects it least. A blocked store, a missing key, and a corrupt
// payload all have to read as a cold start rather than throw.
{
	const { readMemory, writeMemory } = inline;
	const fakeStorage = () => {
		const map = new Map();
		return {
			getItem: (key) => map.has(key) ? map.get(key) : null,
			setItem: (key, value) => void map.set(key, String(value)),
			value: (key) => map.get(key)
		};
	};

	assertEqual(readMemory(void 0), { dismissed: [], order: [] }, "no store at all must read as a cold start");
	assertEqual(readMemory(null), { dismissed: [], order: [] }, "a null store must read as a cold start");
	assertEqual(readMemory(fakeStorage()), { dismissed: [], order: [] }, "a missing key must read as a cold start");

	const corrupt = fakeStorage();
	corrupt.setItem("dsh.session-tabs.v1", "{not json");
	assertEqual(readMemory(corrupt), { dismissed: [], order: [] }, "a corrupt payload must read as a cold start");

	const junk = fakeStorage();
	junk.setItem("dsh.session-tabs.v1", JSON.stringify({ dismissed: ["a", 7, null], order: "nope" }));
	assertEqual(readMemory(junk), { dismissed: ["a"], order: [] }, "a read must keep only string ids");

	const store = fakeStorage();
	const snapshot = JSON.stringify({ dismissed: ["x"], order: ["a", "x"] });
	assertEqual(writeMemory(store, snapshot), true, "a writable store must report success");
	assertEqual(readMemory(store), { dismissed: ["x"], order: ["a", "x"] }, "what was written must read back");
	assertEqual(writeMemory({ setItem() { throw new Error("blocked"); } }, snapshot), false, "a blocked store must report failure, not throw");
	assertEqual(writeMemory(void 0, snapshot), false, "a missing store must report failure, not throw");
}

// ---- 2d. the close control's own hover ----
// Two things at once: hovering the × must light *it* up (not just the chip), and
// it must not change the slot's geometry — a control that grew on hover would move
// the chip again, which is the bug this whole area exists to prevent.
{
	const { closeControlStyle } = inline;
	const idle = closeControlStyle({ visible: true, hover: false });
	const hovered = closeControlStyle({ visible: true, hover: true });
	const hidden = closeControlStyle({});

	for (const key of ["width", "height", "flex", "padding", "borderRadius", "fontSize"]) {
		assertEqual(hovered[key], idle[key], `hovering the control must not change its ${key}`);
	}
	assertEqual(idle.width, 16, "the control slot must stay 16px wide");
	assertEqual(idle.background, "transparent", "an unhovered control must not paint a background");
	assert(hovered.background !== idle.background, "hovering the control must paint its own background");
	assertEqual(hovered.color, "var(--dsw-alias-label-primary)", "a hovered control must brighten its glyph");
	assertEqual(hovered.opacity, 1, "a hovered control must be fully opaque");
	assertEqual(idle.opacity, 0.7, "an unhovered control sits slightly back");
	// The default state is the hidden one: no keys, no throw, nothing painted.
	assertEqual(hidden.visibility, "hidden", "an unconfigured control must be hidden");
	assertEqual(hidden.opacity, 0, "a hidden control must not paint");
	assertEqual(hidden.background, "transparent", "a hidden control must not paint a background");
}

// ---- 3. registration ----
// The dock is declared by the Conversation Factory, which mounts after this
// plugin's own services resolve, so the registration must WAIT for the
// declaration through slots.inject. A bare register() is what broke web boot:
// it throws `slot "conversation.input.dock" is not declared`, and a throwing
// apply fails the plugin's whole fiber.
const registrations = [];
const injected = [];
exports_.apply({
	slots: {
		inject(name, factory) {
			injected.push(name);
			factory();
			return () => {};
		},
		register(meta, Component) {
			registrations.push({ meta, Component });
		}
	},
	sessions: { open() {} }
});
assertEqual(injected, [DOCK_SLOT], "the registration does not wait for the dock declaration");
assertEqual(registrations.length, 1, "expected exactly one slot registration");
const { meta, Component } = registrations[0];
assertEqual(meta.name, DOCK_SLOT, "registered slot");
assertEqual(meta.id, DOCK_ID, "registered id inside the list seat");
assert(typeof Component === "function", "registration carries no component");

// The failure this suite exists to prevent, asserted structurally: apply() must
// not be able to reach register() except from inside the inject callback. A
// bare register() at apply time is what turned a missing declaration into
// `dsh-session-tabs: failed` and aborted web boot.
{
	let insideInject = false;
	let direct = 0;
	exports_.apply({
		slots: {
			inject(name, factory) {
				insideInject = true;
				try {
					factory();
				} finally {
					insideInject = false;
				}
				return () => {};
			},
			register() {
				if (!insideInject) direct += 1;
			}
		},
		sessions: { open() {} }
	});
	assertEqual(direct, 0, "apply() registered a slot without waiting for its declaration");
}

// ---- 4. rendered strip ----
/**
 * Resolve element nodes whose `type` is a function, the way React would, so a
 * chip rendered as a component is inspected as the DOM it actually produces
 * rather than as an unresolved element.
 */
const expand = (node) => {
	if (node === null || typeof node !== "object") return node;
	if (typeof node.type === "function") return expand(node.type(node.props ?? {}));
	const children = (node.props ?? {}).children;
	if (children === void 0) return node;
	return {
		...node,
		props: {
			...node.props,
			children: Array.isArray(children) ? children.map(expand) : expand(children)
		}
	};
};
/** Depth-first search for every node carrying a data attribute. */
const findAll = (node, key, out = []) => {
	if (node === null || typeof node !== "object") return out;
	const props = node.props ?? {};
	if (props[key] !== void 0) out.push(node);
	const children = props.children;
	for (const child of Array.isArray(children) ? children : children === void 0 ? [] : [children]) {
		findAll(child, key, out);
	}
	return out;
};
const visibleText = (node) => {
	if (node === null || typeof node !== "object") return typeof node === "string" ? node : "";
	const children = (node.props ?? {}).children;
	return Array.isArray(children) ? children.map(visibleText).join("") : visibleText(children);
};
/**
 * Render the seated component for one session list.
 *
 * The component is called with the props the dock seat supplies: `useSessions`
 * is the selector the strip reads, `sessionId` is the seat's session binding,
 * and `open` is the bound session-navigation action. `useRef` and `useState`
 * are the stubbed identity. The result is expanded so chips render as the
 * elements they produce.
 */
const renderStrip = (sessions) => {
	/* The strip's memory is module state (it must outlive a remount), so each
	 * fixture starts from a clean slate. */
	inline.resetMemory();
	const opened = [];
	const element = Component({
		useSessions: (selector) => selector(sessions),
		sessionId: sessions.current,
		open: (id) => opened.push(id)
	});
	return { element: expand(element), opened };
};

// ---- 3b. a chip click actually navigates ----
// Chips switch sessions through `uiWorkspace.openSession`, the call the shipped
// conversation header makes for the same action. This used to be
// `ctx.sessions.open`, which does not exist — the sessions service's own `open()`
// is one session's data stream and takes no id — so every click threw and the tab
// read as dead while the sidebar worked.
{
	const opened = [];
	const register = [];
	const ctx = {
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		sessions: {
			open() {
				throw new Error("navigation must not go through the sessions service");
			}
		},
		get: (name) => name === "uiWorkspace" ? { openSession: (id) => opened.push(id) } : undefined
	};
	exports_.apply(ctx);
	const { element } = (() => {
		const sessions = list([row("a", true), row("b", true)], "a");
		return { element: expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: "a", open: () => {} })) };
	})();
	const chips = findAll(element, "data-session-tab");
	assertEqual(chips.length, 2, "expected two chips to click");
	chips[1].props.onClick();
	assertEqual(opened, ["b"], "clicking a chip must open that session through uiWorkspace");
}

// A profile without the workspace UI must not turn a click into a crash.
{
	const register = [];
	exports_.apply({
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		get: () => undefined
	});
	const sessions = list([row("a", true)], "a");
	const chips = findAll(expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: "a", open: () => {} })), "data-session-tab");
	let threw = false;
	try {
		chips[0].props.onClick();
	} catch (error) {
		threw = true;
	}
	assert(!threw, "a missing workspace service must not make a chip click throw");
}

// ---- 3b2. a dismissal survives the render that closing schedules ----
// Only a change of session clears a dismissal. Closing the active tab navigates
// away and re-renders immediately, so "is this the current session?" re-read per
// render would cancel the dismissal just recorded and the tab would come back.
{
	const { clearsDismissal } = inline;
	assertEqual(clearsDismissal(void 0, "a"), true, "the first session seen must clear its (empty) dismissal");
	assertEqual(clearsDismissal("a", "a"), false, "a re-render of the same session must not forget a dismissal");
	assertEqual(clearsDismissal("a", "b"), true, "navigating to another session must clear that session's dismissal");
	assertEqual(clearsDismissal("a", void 0), false, "the hero screen must not clear a dismissal");
}

// ---- 3c. closing a tab must ask for a render ----
// The dismissal set lives in a ref (it is only read while deriving the strip), so
// the close handler has to schedule a render too. Without that the set changed and
// nothing re-rendered: the chip stayed on screen until an unrelated store tick, so
// the × read as dead.
{
	const register = [];
	exports_.apply({
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		get: () => undefined
	});
	const sessions = list([row("a", true), row("b", true)], "a");
	const chips = findAll(expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: "a", open: () => {} })), "data-session-tab");
	const idleClose = findAll(chips[1], "data-session-tab-close")[0];
	assert(idleClose !== void 0, "the idle chip must carry a close control");
	const before = stateWrites.length;
	idleClose.props.onClick({ stopPropagation() {} });
	assert(stateWrites.length > before, "closing a tab must schedule a render — the dismissal lives in a ref");
}

// ---- 3d. a closed tab stays closed across the next render ----
// Drives one component instance through two renders (shared refs, same session):
// the × recorded a dismissal, and the render that follows must still honour it.
// Re-reading "is this the current session?" per render would cancel it here, which
// is exactly how a closed tab used to reappear.
{
	const register = [];
	exports_.apply({
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		get: () => undefined
	});
	const sessions = list([row("a", true), row("b", true)], "a");
	const renderOnce = () => expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: "a", open: () => {} }));

	// Also covers the in-between render of a close-the-active-tab: the stub `open`
	// does not navigate, so the second render still sees sessionId "a" — exactly the
	// race the rule exists for.
	inline.resetMemory();
	beginRender();
	const first = renderOnce();
	const chips = findAll(first, "data-session-tab");
	assertEqual(chips.map((chip) => chip.props["data-session-tab"]), ["a", "b"], "expected both tabs before closing");
	const activeClose = findAll(chips[0], "data-session-tab-close")[0];
	assert(activeClose !== void 0, "the active chip must carry a close control");
	activeClose.props.onClick({ stopPropagation() {} });

	beginRender();
	const second = renderOnce();
	const ids = findAll(second, "data-session-tab").map((chip) => chip.props["data-session-tab"]);
	endRender();
	assertEqual(ids, ["b"], "the closed tab must stay closed on the next render, even while it is still current");
}

// ---- 3e. the memory survives a remount ----
// Opening another session remounts the strip's whole occurrence (the Factory key
// carries the session generation), so a dismissal kept in a ref died on the very
// next click and the closed tab came back. The order died with it, reshuffling the
// tabs on every switch. Both are module state now, and this test drives exactly
// that: no persistent refs, so each render is a fresh mount.
{
	const register = [];
	exports_.apply({
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		get: () => undefined
	});
	const renderWith = (sessions) => expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: sessions.current, open: () => {} }));
	const tabIds = (element) => findAll(element, "data-session-tab").map((chip) => chip.props["data-session-tab"]);

	inline.resetMemory();
	const sessions = list([row("a", true), row("b", true), row("c", true)], "a");
	const closes = findAll(renderWith(sessions), "data-session-tab-close");
	assertEqual(closes.length, 3, "every tab must offer a close control");
	closes[2].props.onClick({ stopPropagation() {} });
	assertEqual(tabIds(renderWith(sessions)), ["a", "b"], "a closed tab must stay closed across a remount");

	// The engagement order survives the same remount: the same sessions come back in
	// a different list order and the strip must keep the order it remembered.
	inline.resetMemory();
	renderWith(sessions);
	const reordered = list([row("c", true), row("b", true), row("a", true)], "a");
	assertEqual(tabIds(renderWith(reordered)), ["a", "b", "c"], "the engagement order must survive a remount");
	inline.resetMemory();
}

// ---- 3f. a page load restores the store ----
// The other half of persistence, and the one the user actually sees: reopening the
// app reloads the page, so the fresh module must start from what was written. This
// runs the bundle factory a second time (a new "page load") against a seeded store.
{
	const map = new Map();
	map.set("dsh.session-tabs.v1", JSON.stringify({ dismissed: ["b"], order: ["c", "b", "a"] }));
	const previous = globalThis.localStorage;
	globalThis.localStorage = {
		getItem: (key) => map.has(key) ? map.get(key) : null,
		setItem: (key, value) => void map.set(key, String(value))
	};
	try {
		const reloaded = captured.factory(fakeRequire);
		const memory = JSON.parse(reloaded.__internals.memorySnapshot());
		assertEqual(memory.dismissed, ["b"], "a fresh page load must restore the dismissals");
		assertEqual(memory.order, ["c", "b", "a"], "a fresh page load must restore the engagement order");
	} finally {
		if (previous === void 0) delete globalThis.localStorage;
		else globalThis.localStorage = previous;
	}
}

// ---- 3g. closing a tab reaches the store ----
// The whole point of persisting: a tab closed now must still be closed after the
// shell reloads its page. This drives the real component against a fake store.
{
	const register = [];
	exports_.apply({
		slots: {
			inject(name, factory) {
				factory();
				return () => {};
			},
			register(meta, Component) {
				register.push({ meta, Component });
			}
		},
		get: () => undefined
	});
	const map = new Map();
	const store = {
		getItem: (key) => map.has(key) ? map.get(key) : null,
		setItem: (key, value) => void map.set(key, String(value))
	};
	const previous = globalThis.localStorage;
	globalThis.localStorage = store;
	try {
		const sessions = list([row("a", true), row("b", true)], "a");
		const renderOnce = () => expand(register[0].Component({ useSessions: (selector) => selector(sessions), sessionId: "a", open: () => {} }));
		inline.resetMemory();
		beginRender();
		const first = renderOnce();
		findAll(first, "data-session-tab-close")[1].props.onClick({ stopPropagation() {} });
		beginRender();
		renderOnce();
		endRender();
		const raw = store.getItem("dsh.session-tabs.v1");
		assert(typeof raw === "string", "closing a tab must write the memory to the store");
		assert(raw.includes("\"b\""), "the written snapshot must carry the dismissed id");
		assert(raw.includes("\"order\""), "the written snapshot must carry the engagement order");
	} finally {
		if (previous === void 0) delete globalThis.localStorage;
		else globalThis.localStorage = previous;
		inline.resetMemory();
	}
}

// ---- 3h. the tab context menu ----
// Right-click on a chip opens a menu of five actions; the model is pure, so the
// rows, their order, their live/disabled state and the bulk close each one runs are
// all assertable without a DOM.
{
	const { contextMenuRows } = inline;
	const rows = contextMenuRows(4, 1);
	assertEqual(rows.map((row) => row.id), ["rename", "close-left", "close-right", "close-others"], "menu rows, in order");
	assertEqual(rows.map((row) => row.label), ["Rename session", "Close all left", "Close all right", "Close all others"], "menu labels");
	assertEqual(rows[0].kind, "rename", "the first row is the rename action");
	assertEqual(rows.slice(1).map((row) => row.side), ["left", "right", "others"], "each bulk close carries its side");
	assertEqual(rows.map((row) => row.disabled === true), [false, false, false, false], "a middle tab leaves every row live");
	assertEqual(rows[1].separatorBefore, true, "the bulk closes are grouped away from rename");

	const first = contextMenuRows(4, 0);
	assertEqual(first.map((row) => row.disabled === true), [false, true, false, false], "the first tab cannot close anything to its left");
	const last = contextMenuRows(4, 3);
	assertEqual(last.map((row) => row.disabled === true), [false, false, true, false], "the last tab cannot close anything to its right");
	const lone = contextMenuRows(1, 0);
	assertEqual(lone.map((row) => row.disabled === true), [false, true, true, true], "a lone tab closes nothing, but can still be renamed");
}

// ---- 3i. the chip's right-click and inline rename ----
{
	const { TabChip } = inline;
	const base = { id: "a", label: "Alpha", title: "Alpha long title", active: true, running: false, closable: true };

	// Right-click reports the pointer and suppresses the browser menu.
	{
		const seen = [];
		let prevented = 0;
		const chip = TabChip({ ...base, renaming: false, onContextMenu: (x, y) => seen.push([x, y]) });
		chip.props.onContextMenu({ preventDefault: () => { prevented += 1; }, clientX: 120, clientY: 40 });
		assertEqual(seen, [[120, 40]], "right-click must report the pointer position");
		assertEqual(prevented, 1, "right-click must suppress the browser menu");
	}

	// Renaming swaps the label slot for an input seeded with the full title.
	{
		let committed;
		let cancelled = 0;
		const chip = TabChip({ ...base, renaming: true, onRenameCommit: (title) => { committed = title; }, onRenameCancel: () => { cancelled += 1; } });
		const input = (chip.props.children ?? []).find((child) => child && child.props && child.props["data-session-tab-rename"] !== void 0);
		assert(input !== void 0, "renaming must render an input in the label slot");
		assertEqual(input.props.defaultValue, "Alpha long title", "the input must be seeded with the full title");
		assertEqual(input.props.autoFocus, true, "the input must take focus so typing just works");
		assertEqual(input.props.style.flex, "1 1 auto", "the input must fill the label slot, keeping the chip a fixed width");

		let stopped = 0;
		input.props.onClick({ stopPropagation: () => { stopped += 1; } });
		assertEqual(stopped, 1, "a click inside the input must not reach the chip's select");
		input.props.onKeyDown({ key: "Enter", preventDefault() {}, currentTarget: { value: "Renamed" } });
		assertEqual(committed, "Renamed", "Enter must commit the typed title");
		input.props.onKeyDown({ key: "Escape", preventDefault() {} });
		input.props.onBlur();
		assertEqual(cancelled, 2, "Escape and blur must abandon the rename");
	}
}

// ---- 3j. renaming goes through the sessions service ----
// `sessions.rename(sessionId, title)` is the service call the sidebar's own rename
// dialog ends at; a plugin cannot raise that dialog (its request store is plugin
// state), so the strip calls the same API behind its inline editor.
{
	const seatComponent = (get) => {
		const register = [];
		exports_.apply({
			slots: {
				inject(name, factory) {
					factory();
					return () => {};
				},
				register(meta, Component) {
					register.push(Component);
				}
			},
			get
		});
		return register[0];
	};

	const renamed = [];
	const seat = seatComponent((name) => name === "sessions" ? {
		rename: (id, title) => {
			renamed.push([id, title]);
			return Promise.resolve();
		}
	} : void 0)({ sessionId: "a" });
	assert(typeof seat.props.rename === "function", "the seat must carry the rename action");
	seat.props.rename("b", "New name");
	assertEqual(renamed, [["b", "New name"]], "renaming must call sessions.rename(sessionId, title)");

	// A refused rename is caught and reported, never thrown out of a click handler.
	const caught = [];
	const refusing = seatComponent((name) => name === "sessions" ? {
		rename: () => ({ catch: (handler) => caught.push(typeof handler) })
	} : void 0)({ sessionId: "a" });
	refusing.props.rename("b", "New name");
	assertEqual(caught, ["function"], "a refused rename must be caught, not surfaced");

	// A profile without the sessions service costs the rename, not the strip.
	const missing = seatComponent(() => void 0)({ sessionId: "a" });
	let threw = false;
	try {
		missing.props.rename("b", "New name");
	} catch (error) {
		threw = true;
	}
	assert(!threw, "a missing sessions service must not make renaming throw");
}

// ---- 4a. placement: the first row of the conversation column ----
// anchorStripHost decides where the strip is *drawn*. The shipped DOM is a flex
// column whose children are the header anchor and the content element, so the
// strip's own row is inserted ahead of both; an embedded occurrence (no header of
// its own) draws nothing; an unrecognized shape leaves the strip in the dock it
// was registered in. The last case is the safety net: a future app version can
// move the strip, but not lose it.
const createDoc = () => ({ createElement: (tag) => ({ tag, style: {}, attrs: {}, isConnected: true, setAttribute(name, value) { this.attrs[name] = value; }, remove() {} }) });
{
	const anchored = [];
	const appended = [];
	const header = { tagName: "HEADER" };
	const headerAnchor = { tagName: "DIV", querySelector: (selector) => selector === "header" ? header : null };
	const content = {
		tagName: "DIV",
		classList: [],
		parentElement: null,
		closest(selector) {
			if (selector === "[data-conversation-content]") return content;
			return null;
		}
	};
	const column = {
		children: [headerAnchor, content],
		firstElementChild: headerAnchor,
		insertBefore(node, reference) { anchored.push({ node, reference }); },
		append(node) { appended.push(node); }
	};
	content.parentElement = column;
	const host = anchorStripHost({ ownerDocument: createDoc(), closest: () => content });
	assert(host !== void 0 && host !== null, "a conversation column with a header must anchor a host row");
	assertEqual(anchored.length, 1, "the host row was not inserted into the column");
	assertEqual(anchored[0].reference, headerAnchor, "the host row is not the column's first row");
	assertEqual(appended.length, 0, "the host row must not be appended below the existing rows");
	assertEqual(host.attrs["data-session-tabs-host"], "", "the anchored row is not addressable");
	assert(host.style.cssText.includes("flex:none"), "the anchored row must not stretch the column's flex layout");
}
{
	// An embedded occurrence (subagent preview) marks its content element.
	const embedded = { classList: ["ST7X_W_embeddedBody"], parentElement: null, closest: () => null };
	assertEqual(anchorStripHost({ ownerDocument: createDoc(), closest: () => embedded }), null, "an embedded occurrence must draw nothing");
	// A column with no header is not a shape we know: dock fallback.
	const content = {
		tagName: "DIV",
		classList: [],
		parentElement: { children: [], firstElementChild: null, insertBefore() {}, append() {} },
		closest(selector) { return selector === "[data-conversation-content]" ? content : null; }
	};
	assertEqual(anchorStripHost({ ownerDocument: createDoc(), closest: () => content }), void 0, "a column without a header must fall back to the dock");
	// No conversation content ancestor at all: dock fallback.
	assertEqual(anchorStripHost({ ownerDocument: createDoc(), closest: () => null }), void 0, "an unrecognized shape must fall back to the dock");
	assertEqual(anchorStripHost(null), void 0, "a missing placeholder must fall back to the dock");
}

// ---- 4b. the strip is additive, and never lost ----
{
	const { element } = renderStrip(list([row("a", true, { displayTitle: "Alpha" })], "a"));
	assertEqual(findAll(element, "data-session-tabs").length, 1, "the strip is not addressable");
	assertEqual(findAll(element, "data-session-tabs-header").length, 0, "a single-seat header wrapper is still rendered");
	assertEqual(findAll(element, "data-session-tabs-anchor").length, 1, "the anchoring seat is not addressable");
	assert(visibleText(element).includes("Alpha"), "the strip is missing from the seat");
	const strip = findAll(element, "data-session-tabs")[0];
	assertEqual(strip.props.style.overflowX, "auto", "the strip must scroll sideways once the tabs outgrow the row");
	// The bar itself is the shell's: ui-theme installs unscoped ::-webkit-scrollbar
	// rules (5px wide, rounded thumb in --dsw-alias-scrollbar-bg-l1, hover colour).
	// Chromium ignores those for any element that sets the *standard* properties, so
	// the strip must stay out of their way — that is what produced a fat native bar.
	assert(strip.props.style.scrollbarWidth === void 0, "the strip must not set scrollbar-width, or the shell's themed scrollbar is ignored");
	assert(strip.props.style.scrollbarColor === void 0, "the strip must not set scrollbar-color for the same reason");
}

// The stub runs no effects, so no host is ever anchored here: the strip must then
// be drawn exactly where it was registered — the dock — rather than vanish.
{
	const { element } = renderStrip(list([row("a", true)], "a"));
	assertEqual(findAll(element, "data-session-tabs").length, 1, "the dock fallback did not draw the strip");
}

// With no session the strip draws nothing rather than an empty bar.
{
	const { element } = renderStrip(list([], void 0));
	assertEqual(findAll(element, "data-session-tabs").length, 0, "the strip drew without a session");
}

// ---- 4c. rendered chips ----

{
	const sessions = list([row("a", true), row("b", false)], "b");
	const { element } = renderStrip(sessions);
	const chips = findAll(element, "data-session-tab");
	assertEqual(chips.length, 2, "two sessions produce two chips");
	assertEqual(chips.map((chip) => chip.props["data-session-tab"]), ["a", "b"], "chips are in strip order");
	assertEqual(chips.map((chip) => chip.props["data-active"]), ["false", "true"], "the current session's chip is active");
	assertEqual(findAll(element, "data-session-tabs").length, 1, "the strip is not addressable by its data attribute");
}

// Every chip is the same width, whatever its title: a strip whose tabs resize with
// their text reads as noise, and one long title would shove its neighbours around.
{
	const { TAB_WIDTH } = inline;
	const sessions = list([row("a", true, { displayTitle: "Fix" }), row("b", true, { displayTitle: "Add DeepSeek peak/off-peak session tabs" })], "a");
	const chips = findAll(renderStrip(sessions).element, "data-session-tab");
	assertEqual(chips.length, 2, "two sessions produce two chips");
	assertEqual(chips.map((chip) => chip.props.style.width), [TAB_WIDTH, TAB_WIDTH], "chips must be a fixed width, not sized by their titles");
	assertEqual(chips.map((chip) => chip.props.style.boxSizing), ["border-box", "border-box"], "the fixed width must include padding and the control slot");
	assert(chips[0].props.style.maxWidth === void 0, "a content cap must not be left in place to fight the fixed width");
	// The label takes what the fixed width leaves and ellipsizes there.
	const label = findAll(chips[1], "data-session-tab-label")[0];
	assertEqual(label.props.style.flex, "1 1 auto", "the label must take the room the fixed width leaves");
	assertEqual(label.props.style.minWidth, 0, "the label must be allowed to shrink below its text");
	assertEqual(label.props.style.textOverflow, "ellipsis", "the label must ellipsize inside the fixed chip");
	// The pixel fit measures this node, so the ref is what makes it reachable.
	assert(label.props.ref !== void 0 && label.props.ref !== null, "the label must carry a ref, or the pixel fit never runs");
}

// The chip label is the shortened title, and the full title stays reachable as
// the tooltip, so truncation never hides which session a chip is.
{
	const long = "Add DeepSeek peak/off-peak session tabs";
	const sessions = list([row("a", true, { displayTitle: long })], "a");
	const { element } = renderStrip(sessions);
	const chips = findAll(element, "data-session-tab");
	assertEqual(chips.length, 1, "one engaged session renders one chip");
	assertEqual(chips[0].props.title, long, "the chip tooltip carries the full title");
	assertEqual(visibleText(chips[0]), chipLabel(long), "the chip shows the shortened title");
	assert(!visibleText(chips[0]).includes(long), "the chip does not render the full title");
}

// A running session's chip is marked; a still one is not.
{
	const sessions = list([row("a", true, { running: true }), row("b", true)], "a");
	const { element } = renderStrip(sessions);
	const chips = findAll(element, "data-session-tab");
	const dot = (chip) => chip.props.children[0].props.style;
	assertEqual(dot(chips[0]).background.includes("success"), true, "a running session's chip shows the running dot");
	assertEqual(dot(chips[1]).background, "transparent", "a still session's chip has no running dot");
}

// Closing: the control is *reserved*, and only its visibility follows the
// pointer. Inserting it on hover used to widen the chip and shove every chip
// after it sideways, so the slot is asserted to be identical in every state.
{
	const many = list([row("a", true), row("b", true)], "a");
	const twoChips = findAll(renderStrip(many).element, "data-session-tab");
	const closeControl = (chip) => findAll(chip, "data-session-tab-close")[0];

	const activeClose = closeControl(twoChips[0]);
	const idleClose = closeControl(twoChips[1]);
	assert(activeClose !== void 0, "the active chip must carry a close control");
	assert(idleClose !== void 0, "an inactive chip must still carry the control — that slot is what keeps the width fixed");
	assertEqual(activeClose.props.style.visibility, "visible", "the active chip's control must be visible");
	assertEqual(idleClose.props.style.visibility, "hidden", "an untouched chip's control must be hidden");
	assertEqual(idleClose.props.style.opacity, 0, "a hidden control must not paint");
	assertEqual(activeClose.props.style.width, idleClose.props.style.width, "the control slot must not vary in width");
	assertEqual(idleClose.props.style.width, 16, "the control slot must be a fixed width");
	assertEqual(idleClose.props.style.flex, "0 0 auto", "the control slot must neither shrink nor grow");
	// Nothing is added when the control becomes visible: same children, same count.
	assertEqual(
		twoChips[0].props.children.length,
		twoChips[1].props.children.length,
		"a chip showing its control must not have more children than an idle one"
	);

	const single = list([row("a", true)], "a");
	const oneChip = findAll(renderStrip(single).element, "data-session-tab");
	assert(closeControl(oneChip[0]) === void 0, "the last remaining tab must not carry a control");

	const previewOnly = list([row("a", false)], "a");
	const previewChip = findAll(renderStrip(previewOnly).element, "data-session-tab");
	assert(closeControl(previewChip[0]) === void 0, "a preview tab must not carry a control");
}

// An empty list with a current id that has no row must not throw.
{
	assertEqual(deriveTabs({ ids: [], byId: {}, current: "missing", order: [] }).ids, [], "an unknown current id is ignored");
}

if (process.exitCode === void 0) {
	console.log(
		`ok: recycle rule + full-order memory (no rotation) + sideways strip + chip labels + wheel mapping + inline parity + ${DOCK_SLOT} registration (list id ${DOCK_ID}) + top-row anchoring (dock fallback) + bulk closes + context menu (rename via sessions.rename) + fixed-width chips + reserved close slot (own hover) + chip navigation + close renders + dismissal memory (remount + reload persisted) verified`
	);
}
