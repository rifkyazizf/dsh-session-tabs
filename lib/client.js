window.__ModuleLoader__.load({
	id: "dsh-session-tabs",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_jsx_runtime = require("react/jsx-runtime");
		/* A platform seed word (the shell's staticModules table), used only to move the
		 * strip's element into the row this plugin anchors under the conversation
		 * header. See the placement note below. */
		const react_dom = require("react-dom");
		/* The shell's own menu material and rows, so a tab's context menu looks and
		 * behaves like the sidebar's session menu. A platform seed word too. */
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region policy
		/**
		 * The session-tab policy. This block is a verbatim inline of
		 * `lib/policy.js`, the file `verify.mjs` imports and tests: a client
		 * bundle may require only the shell seed words (`react`,
		 * `react/jsx-runtime`, `react-dom`), so it cannot `import` a sibling
		 * module, and duplicating the logic is only safe if the two copies are
		 * provably the same. `verify.mjs` asserts they agree on every exported
		 * function and across its cases.
		 */
		function isEngaged(summary) {
			if (summary === undefined || summary === null) return false;
			return summary.blank === false;
		}
		function isTabCandidate(summary) {
			if (summary === undefined || summary === null) return false;
			return summary.origin !== "subagent";
		}
		function deriveTabs(input) {
			const ids = input.ids ?? [];
			const byId = input.byId ?? {};
			const current = input.current;
			const previous = input.order ?? [];
			const engaged = [];
			const seen = new Set();
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
			const currentSummary = current === undefined ? undefined : byId[current];
			const preview = isTabCandidate(currentSummary) && !isEngaged(currentSummary) ? current : undefined;
			return {
				ids: preview === undefined ? engaged : [...engaged, preview],
				preview,
				engaged
			};
		}
		/**
		 * One strip step: derive from the remembered order, and hand back the order
		 * to remember next. The memory is the *whole* engagement order — a truncated
		 * memory is not a fixed point and rotated the strip on every re-render.
		 */
		function stepTabs(input) {
			const derived = deriveTabs(input);
			return {
				ids: derived.ids,
				preview: derived.preview,
				order: derived.engaged
			};
		}
		function closeRangeIds(tabs, id, side) {
			const index = tabs.findIndex((tab) => tab.id === id);
			if (index < 0) return [];
			const doomed = side === "left" ? tabs.slice(0, index) : side === "right" ? tabs.slice(index + 1) : tabs.filter((tab) => tab.id !== id);
			return doomed.map((tab) => tab.id);
		}
		function closeRangeAvailability(count, index) {
			return {
				left: index > 0,
				right: index >= 0 && index < count - 1,
				others: count > 1
			};
		}
		function chipLabel(title, budget = 18) {
			const text = typeof title === "string" ? title : "";
			const trimmed = text.trim();
			if (trimmed.length <= budget) return trimmed;
			const clipped = trimmed.slice(0, budget);
			const lastSpace = clipped.lastIndexOf(" ");
			const cut = lastSpace >= Math.floor(budget * 0.6) ? clipped.slice(0, lastSpace) : clipped;
			return `${cut.trimEnd()}…`;
		}
		/**
		 * Graphemes, so a cut cannot land inside a surrogate pair or an emoji
		 * sequence. `Intl.Segmenter` where the engine has it; code points otherwise.
		 */
		function graphemes(text) {
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
		 * Fit a title to the pixel width the label slot actually has — the fit the
		 * user sees. `chipLabel` above is only the pre-layout fallback: a character
		 * budget cannot know that the same 18 characters are 86px in one title and
		 * 200px in another, which is what left most of a 141px slot empty. Only a
		 * one-character orphan is discarded at the edge; a longer tail spends the slot.
		 */
		function fitLabel(title, available, measure, options = {}) {
			const text = typeof title === "string" ? title.trim() : "";
			if (text === "") return "";
			if (typeof measure !== "function" || !(available > 0)) return text;
			const ellipsis = typeof options.ellipsis === "string" && options.ellipsis !== "" ? options.ellipsis : "…";
			const maxStub = Number.isFinite(options.maxStub) ? Math.max(0, Math.floor(options.maxStub)) : 1;
			if (measure(text) <= available) return text;
			const room = available - measure(ellipsis);
			if (!(room > 0)) return "";
			const chars = graphemes(text);
			let low = 0;
			let high = chars.length;
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				if (measure(chars.slice(0, middle).join("")) <= room) low = middle;
				else high = middle - 1;
			}
			let cut = chars.slice(0, low).join("").trimEnd();
			/* Only a cut *inside* a word is backed off: one that already ends on a
			 * space is word-shaped, and the space before it belongs to the next word. */
			if (low < chars.length && chars[low] !== " ") {
				const space = chars.slice(0, low).join("").lastIndexOf(" ");
				if (space > 0 && low - space - 1 <= maxStub) cut = chars.slice(0, space).join("").trimEnd();
			}
			return cut === "" ? "" : `${cut}${ellipsis}`;
		}
		//#endregion

		//#region view
		/**
		 * How far one wheel event should move the strip, horizontally.
		 *
		 * Shared by the native wheel listener and `verify.mjs`, which asserts the
		 * mapping without a DOM: a vertical wheel moves the strip sideways by the
		 * same amount (the usual mapping for a horizontal strip inside a vertical
		 * page), a horizontal gesture keeps its own delta, and an event that moves
		 * nothing — or arrives when the strip has no overflow to scroll — returns 0
		 * so the caller leaves the event for the transcript.
		 *
		 * @param event - a WheelEvent-shaped object.
		 * @param scrollable - whether the strip overflows at all.
		 * @returns the number of pixels to add to `scrollLeft`, or 0 to pass the event on.
		 */
		function scrollStep(event, scrollable) {
			if (scrollable !== true) return 0;
			const horizontal = event.deltaX ?? 0;
			const vertical = event.deltaY ?? 0;
			if (horizontal === 0 && vertical === 0) return 0;
			return Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
		}

		/**
		 * Whether this render must forget a session's dismissal.
		 *
		 * A session you navigate back to loses its dismissal — but only a *change* of
		 * session counts. Closing the active tab navigates away and immediately
		 * re-renders, and re-reading "is this the current session?" on every render
		 * would cancel the dismissal the click had just recorded, so the closed tab
		 * would reappear as soon as the switch landed.
		 *
		 * @param previousSession - the session id the last render saw.
		 * @param sessionId - the session id this render sees.
		 * @returns true when a dismissal for `sessionId` must be dropped.
		 */
		function clearsDismissal(previousSession, sessionId) {
			return sessionId !== undefined && sessionId !== previousSession;
		}

		/**
		 * The close control's style, from its two states.
		 *
		 * Pure so `verify.mjs` can assert the thing that matters: **hovering the control
		 * changes only colours**. The slot's geometry (a 16px square that neither grows
		 * nor shrinks) is identical in every state, which is what keeps a chip's width
		 * fixed while the pointer moves across it. `visible` follows the chip's hover
		 * and selection; `hover` is the control's own, tighter highlight so it reads as
		 * a target of its own rather than part of the chip's background.
		 *
		 * @param state - `{ visible, hover }`, both optional and false by default.
		 * @returns the control's inline style.
		 */
		function closeControlStyle(state) {
			const visible = state.visible === true;
			const hover = state.hover === true;
			return {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 16,
				height: 16,
				flex: "0 0 auto",
				padding: 0,
				border: "none",
				borderRadius: "50%",
				cursor: "pointer",
				background: hover ? "rgba(127,127,127,0.30)" : "transparent",
				color: hover ? "var(--dsw-alias-label-primary)" : "inherit",
				fontSize: 13,
				lineHeight: 1,
				visibility: visible ? "visible" : "hidden",
				opacity: visible ? hover ? 1 : 0.7 : 0,
				transition: "background 120ms ease, color 120ms ease, opacity 120ms ease"
			};
		}

		/**
		 * The close control.
		 *
		 * Its own component only to own a hover state: the chip already highlights on
		 * hover, and the × needs a second, smaller highlight inside it. The reserved
		 * 16px slot stays exactly the same size in every state — see
		 * {@link closeControlStyle}.
		 *
		 * @param props - the tab title (for the label), visibility, and the close action.
		 * @returns the close button.
		 */
		function CloseControl(props) {
			const [hover, setHover] = react.useState(false);
			return react_jsx_runtime.jsx("button", {
				type: "button",
				"aria-label": `Close ${props.title}`,
				"data-session-tab-close": "",
				"data-close-hover": hover ? "true" : "false",
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				onClick: (event) => {
					event.stopPropagation();
					props.onClose();
				},
				style: closeControlStyle({
					visible: props.visible,
					hover
				}),
				children: "×"
			});
		}

		/**
		 * The rows of a tab's context menu.
		 *
		 * Pure, so the shape is assertable without a DOM: which rows exist, in which
		 * order, which ones are live at a given position, and which bulk close each one
		 * runs. The component below only turns them into shell menu rows.
		 *
		 * @param count - tabs on the strip.
		 * @param index - the right-clicked tab's position.
		 * @returns one descriptor per row, in display order.
		 */
		function contextMenuRows(count, index) {
			const live = closeRangeAvailability(count, index);
			return [{
				id: "rename",
				label: "Rename session",
				kind: "rename"
			}, {
				id: "close-left",
				label: "Close all left",
				kind: "close",
				side: "left",
				disabled: !live.left,
				separatorBefore: true
			}, {
				id: "close-right",
				label: "Close all right",
				kind: "close",
				side: "right",
				disabled: !live.right
			}, {
				id: "close-others",
				label: "Close all others",
				kind: "close",
				side: "others",
				disabled: !live.others
			}];
		}

		/**
		 * A tab's context menu.
		 *
		 * `MenuSurface` is the shell's menu card (translucent material, rounded, plus the
		 * macOS blur backing) and `MenuItemButton` is its row — the same pair the
		 * sidebar's session menu renders — so this needs no styling of its own to match
		 * the app. It is portaled to the body: the strip clips its own overflow, and a
		 * card placed inside it would be cut off.
		 *
		 * Placement is measured after mount and clamped to the viewport, since a
		 * right-click near an edge would otherwise push the card off-screen.
		 *
		 * @param props - pointer position, the rows, and the close action.
		 * @returns the portaled menu card.
		 */
		function ContextMenu(props) {
			const surface = react.useRef(null);
			/* Hidden for the first paint, so the clamp works from real dimensions. */
			const [placement, setPlacement] = react.useState({ left: props.x, top: props.y, visibility: "hidden" });
			const closeRef = react.useRef(props.onClose);
			closeRef.current = props.onClose;

			react.useEffect(() => {
				const node = surface.current;
				if (node === null) return void 0;
				const rect = node.getBoundingClientRect();
				const margin = 8;
				setPlacement({
					left: Math.max(margin, Math.min(props.x, (globalThis.innerWidth ?? 0) - rect.width - margin)),
					top: Math.max(margin, Math.min(props.y, (globalThis.innerHeight ?? 0) - rect.height - margin)),
					visibility: "visible"
				});
				return void 0;
			}, [props.x, props.y]);

			/* Escape, a pointer outside, a scroll, or a resize all dismiss it. */
			react.useEffect(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") closeRef.current();
				};
				const onPointerDown = (event) => {
					const node = surface.current;
					if (node !== null && event.target instanceof Node && node.contains(event.target)) return;
					closeRef.current();
				};
				const onDismiss = () => closeRef.current();
				globalThis.addEventListener?.("keydown", onKeyDown, true);
				globalThis.addEventListener?.("pointerdown", onPointerDown, true);
				globalThis.addEventListener?.("scroll", onDismiss, true);
				globalThis.addEventListener?.("resize", onDismiss);
				return () => {
					globalThis.removeEventListener?.("keydown", onKeyDown, true);
					globalThis.removeEventListener?.("pointerdown", onPointerDown, true);
					globalThis.removeEventListener?.("scroll", onDismiss, true);
					globalThis.removeEventListener?.("resize", onDismiss);
				};
			}, []);

			/* Arrow keys walk the live rows, wrapping at both ends. */
			const onKeyDown = (event) => {
				if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
				const node = surface.current;
				if (node === null) return;
				const rows = [...node.querySelectorAll('[role="menuitem"]:not([disabled])')];
				if (rows.length === 0) return;
				const step = event.key === "ArrowDown" ? 1 : -1;
				const current = rows.indexOf(node.ownerDocument.activeElement);
				const base = current < 0 ? (step > 0 ? -1 : 0) : current;
				const next = rows[(base + step + rows.length) % rows.length];
				if (next === void 0) return;
				event.preventDefault();
				next.focus();
			};

			const doc = globalThis.document;
			if (doc === void 0 || doc === null || doc.body === null) return null;
			return react_dom.createPortal(react_jsx_runtime.jsx(primitives.MenuSurface, {
				role: "menu",
				ref: surface,
				onKeyDown,
				"data-session-tabs-menu": "",
				style: {
					position: "fixed",
					left: placement.left,
					top: placement.top,
					visibility: placement.visibility,
					zIndex: 1000
				},
				children: props.items.map((item) => react_jsx_runtime.jsx(primitives.MenuItemButton, {
					icon: item.icon,
					disabled: item.disabled === true,
					danger: item.danger === true,
					separatorBefore: item.separatorBefore === true,
					onSelect: () => {
						closeRef.current();
						item.onSelect();
					},
					children: item.label
				}, item.id))
			}), doc.body);
		}

		/**
		 * The width every chip is given, in px.
		 *
		 * Fixed rather than content-sized: a strip whose tabs widen and narrow with
		 * their titles reads as noise, and a busy title would push the neighbours
		 * around. The chip's own box is `border-box`, so this is the full width the chip
		 * occupies including its padding; the label takes what is left and is fitted to
		 * that width (`fitLabel`), not to a character count.
		 */
		const TAB_WIDTH = 190;

		/**
		 * Slack left between what the label measures and the slot it must fit, in px.
		 *
		 * The canvas and the layout engine agree to well under a pixel, but a label
		 * that overshoots by a fraction loses its ellipsis to the span's own clip —
		 * which reads as a chopped word. One pixel is cheaper than that.
		 */
		const LABEL_SAFETY = 1;

		/**
		 * A `(text) => px` measurer for the font a node is *actually* rendered in,
		 * or `undefined` when this environment cannot measure.
		 *
		 * A detached canvas lays the string out with the same engine the DOM uses.
		 * The font comes from `getComputedStyle` rather than the inline style the
		 * chip sets, so a sibling plugin or a shell theme that changes the family,
		 * the size, or the letter spacing moves the cut with it. `undefined` is a
		 * supported answer: `fitLabel` then hands back the whole title and the
		 * span's `text-overflow: ellipsis` does the clipping.
		 *
		 * @param node - the label element.
		 * @returns the measurer, or undefined.
		 */
		function nodeMeasurer(node) {
			const style = typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(node) : void 0;
			if (style === void 0 || style === null) return void 0;
			let context;
			try {
				context = globalThis.document?.createElement?.("canvas")?.getContext?.("2d");
			} catch {
				return void 0;
			}
			if (context === void 0 || context === null) return void 0;
			try {
				/* Chromium lays canvas text with the element's spacing too; harmless
				 * where the property does not exist. */
				context.letterSpacing = style.letterSpacing ?? "normal";
			} catch {
				/* not a canvas that supports it: the default spacing stands */
			}
			const font = `${style.fontStyle ?? ""} ${style.fontWeight ?? ""} ${style.fontSize ?? ""} ${style.fontFamily ?? ""}`.trim();
			if (font === "") return void 0;
			return (text) => {
				context.font = font;
				return context.measureText(text).width;
			};
		}

		/**
		 * One tab chip.
		 *
		 * A state dot, the shortened title, and a close control. The close control is
		 * **reserved**, not appended: a closable chip always carries the slot, and only
		 * its visibility follows the pointer (always visible on the active chip). It
		 * used to be added on hover, which widened that chip and shoved every chip
		 * after it sideways under the cursor — a worse cost than the ~21px the slot
		 * takes. The control carries its own, tighter hover highlight. Nothing is reserved for the last remaining tab or for a preview,
		 * since neither can be closed (a strip with nothing on it has no way back).
		 *
		 * @param props - the tab's identity, label, states, and callbacks.
		 * @returns the chip.
		 */
		function TabChip(props) {
			const [hover, setHover] = react.useState(false);
			/*
			 * The label the chip wears. `props.label` is the pre-layout fallback; the
			 * effect below fits the title to the slot's real pixel width instead. It is
			 * a *layout* effect on purpose: the first painted frame must already carry
			 * the fitted label, not a short fallback that snaps forward afterwards.
			 */
			const [fitted, setFitted] = react.useState(() => props.label ?? chipLabel(props.title));
			const labelRef = react.useRef(null);
			react.useLayoutEffect(() => {
				const node = labelRef.current;
				if (node === null || node === void 0) return void 0;
				const measure = nodeMeasurer(node);
				if (measure === void 0) return void 0;
				const fit = () => {
					const rect = node.getBoundingClientRect?.();
					const next = fitLabel(props.title, (rect?.width ?? 0) - LABEL_SAFETY, measure);
					setFitted((previous) => (previous === next ? previous : next));
				};
				fit();
				/* A web font can land after the first layout; refit once it has, or the
				 * label keeps the fallback face's metrics. */
				const fonts = globalThis.document?.fonts;
				if (typeof fonts?.ready?.then !== "function") return void 0;
				let live = true;
				fonts.ready.then(() => {
					if (live) fit();
				});
				return () => {
					live = false;
				};
			}, [props.title, props.label]);
			const active = props.active;
			const closable = props.closable;
			const title = props.title;
			return react_jsx_runtime.jsx("div", {
				"data-session-tab": props.id,
				"data-active": active ? "true" : "false",
				title,
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				onContextMenu: (event) => {
					/* Suppress the browser menu; the tab menu is ours. */
					event.preventDefault();
					props.onContextMenu(event.clientX, event.clientY);
				},
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					/* `border-box`, so the fixed width is the chip's whole box: padding and
					 * the reserved control slot live inside it. */
					boxSizing: "border-box",
					flex: "0 0 auto",
					width: TAB_WIDTH,
					height: 30,
					padding: "0 5px 0 10px",
					/* A browser tab's shape: rounded shoulders, square feet, so the chip sits
					 * flat on the frame's rail. */
					borderRadius: "8px 8px 0 0",
					cursor: "pointer",
					userSelect: "none",
					/*
					 * The active chip is filled with the *pane's* own surface, not a raised
					 * one, which is what makes it read as connected to the row below instead
					 * of as a chip floating on the bar. Being opaque, it also covers the rail
					 * under itself — see the strip's background for why the rail is painted
					 * rather than a `border-bottom`.
					 */
					background: active ? "var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1))" : hover ? "rgba(127,127,127,0.16)" : "transparent",
					color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
					transition: "background 120ms ease, color 120ms ease"
				},
				onClick: () => props.onSelect(),
				children: [
					react_jsx_runtime.jsx("span", {
						"aria-hidden": "true",
						style: {
							width: 6,
							height: 6,
							flex: "0 0 auto",
							borderRadius: "50%",
							background: props.running ? "var(--dsw-alias-state-success-primary, #22c55e)" : "transparent",
							border: props.running ? "none" : "1px solid currentColor",
							opacity: props.running ? 1 : 0.45
						}
					}),
					/*
					 * Renaming edits in place, in the label's slot: the same fixed chip, an
					 * input instead of the text. Enter commits, Escape and blur abandon, and
					 * clicks inside never reach the chip's own select handler.
					 */
					props.renaming === true ? react_jsx_runtime.jsx("input", {
						type: "text",
						"data-session-tab-rename": "",
						defaultValue: title,
						autoFocus: true,
						onFocus: (event) => event.currentTarget.select?.(),
						onClick: (event) => event.stopPropagation(),
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								props.onRenameCommit(event.currentTarget.value);
							} else if (event.key === "Escape") {
								event.preventDefault();
								props.onRenameCancel();
							}
						},
						onBlur: () => props.onRenameCancel(),
						style: {
							/* Fills the label slot, so the chip keeps its fixed width. */
							flex: "1 1 auto",
							minWidth: 0,
							height: 18,
							padding: "0 4px",
							border: "none",
							borderRadius: 4,
							outline: "none",
							background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.2))",
							color: "var(--dsw-alias-label-primary)",
							font: "inherit",
							fontSize: 12
						}
					}) : react_jsx_runtime.jsx("span", {
						ref: labelRef,
						"data-session-tab-label": title,
						style: {
							/* Takes the room the fixed width leaves after the dot and the control
							 * slot; the fitted label fills it. `overflow`/`textOverflow` stay as
							 * the hard guard: measurement is a prediction, and this is what makes
							 * an overshoot impossible — so a longer title never widens the chip,
							 * whatever font size the shell is set to. */
							flex: "1 1 auto",
							fontSize: 12,
							lineHeight: "16px",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							minWidth: 0
						},
						children: fitted
					}),
					/*
					 * Always in the tree for a closable chip, hidden rather than absent: the slot
					 * keeps its 16px + gap in the layout at all times, so hovering can change
					 * visibility but never geometry.
					 */
					closable && react_jsx_runtime.jsx(CloseControl, {
						title,
						visible: hover || active,
						onClose: props.onClose
					})
				].filter(Boolean)
			});
		}
		//#region memory
		/**
		 * Presentation memory for the strip: which tabs you closed, and the engagement
		 * order. It lives here, in module state, and is written to `localStorage`.
		 *
		 * Module state, not a ref, because switching sessions remounts the strip's whole
		 * occurrence (the Factory key carries the session generation) — a ref would die
		 * on every click elsewhere. `localStorage`, because the shell reloads its page
		 * when the app restarts, and "closed until you restart the app" is not a lifetime
		 * a tab strip can have. Shipped client plugins persist the same way (the
		 * conversation's transcript width, the right sidebar's layout).
		 *
		 * Both halves are conveniences: a blocked store, a corrupt payload, or a cold
		 * profile all mean "no memory yet", never an error. The engaged set itself is
		 * durable on the host (`blank`), so only dismissals and ordering are lost.
		 */
		/** Versioned key, dotted like the ones shipped client plugins use. */
		const STORAGE_KEY = "dsh.session-tabs.v1";

		/** Only strings, so a hand-edited or older payload cannot inject junk ids. */
		function stringList(value) {
			if (!Array.isArray(value)) return [];
			return value.filter((entry) => typeof entry === "string");
		}

		/**
		 * Read the persisted memory. A missing store, missing key, or unparseable
		 * payload all read as a cold start.
		 *
		 * @param storage - a Storage-shaped object, or undefined where there is none.
		 * @returns `{ dismissed, order }`, both string arrays.
		 */
		function readMemory(storage) {
			if (storage === void 0 || storage === null) return { dismissed: [], order: [] };
			try {
				const raw = storage.getItem(STORAGE_KEY);
				if (raw === null || raw === void 0) return { dismissed: [], order: [] };
				const parsed = JSON.parse(raw);
				return {
					dismissed: stringList(parsed?.dismissed),
					order: stringList(parsed?.order)
				};
			} catch {
				return { dismissed: [], order: [] };
			}
		}

		/**
		 * Write one snapshot.
		 *
		 * @param storage - a Storage-shaped object, or undefined.
		 * @param snapshot - the serialized memory.
		 * @returns whether the store accepted it (a blocked or full store reports false).
		 */
		function writeMemory(storage, snapshot) {
			if (storage === void 0 || storage === null) return false;
			try {
				storage.setItem(STORAGE_KEY, snapshot);
				return true;
			} catch {
				return false;
			}
		}

		/** The persisted memory this page started from. */
		const persistedMemory = readMemory(globalThis.localStorage);
		/** Session ids closed off the strip; dropped again when that session is visited. */
		const dismissedTabs = new Set(persistedMemory.dismissed);
		/** The engagement order, oldest engagement first, shared by every mount. */
		let engagementOrder = persistedMemory.order;
		/** The last snapshot the store accepted, so identical renders never write. */
		let savedSnapshot = JSON.stringify({
			dismissed: persistedMemory.dismissed,
			order: persistedMemory.order
		});

		/** Serialize the live memory. */
		function memorySnapshot() {
			return JSON.stringify({
				dismissed: [...dismissedTabs],
				order: engagementOrder
			});
		}
		//#endregion
		/**
		 * The session tab strip.
		 *
		 * Seated in `conversation.input.dock`, a list seat spanning the
		 * conversation column just above the composer. That is a safe additive
		 * seat: it already carries the todo, goal, and queue docks, so a fresh id
		 * is rendered beside them rather than replacing one.
		 *
		 * @param props - standard session hooks and the injected tab actions.
		 * @returns the strip, or null when there is nothing to show.
		 */
		function SessionTabs(props) {
			const list = props.useSessions((state) => state);
			const sessionId = props.sessionId;
			/*
			 * Sessions closed off the strip. A dismissed tab must not reappear on
			 * the next render just because the session is still engaged, so the
			 * derived strip is filtered by this set. The set is dropped whenever
			 * the session becomes current again (by any route, including the
			 * sidebar), so a dismissal lasts only until you go back to it.
			 */
			/*
			 * The render ticket for a close. `dismissedTabs` is plain module state, so
			 * closing a tab has to ask React for a render as well. Without it the set
			 * changed but nothing re-rendered: the chip stayed on screen (and the ×
			 * re-clicked) until some unrelated store tick arrived, which read as "the ×
			 * does nothing".
			 */
			const [, setDismissTicket] = react.useState(0);
			const previousSession = react.useRef(void 0);
			if (clearsDismissal(previousSession.current, sessionId)) dismissedTabs.delete(sessionId);
			previousSession.current = sessionId;

			/*
			 * Which sessions the strip remembers. Kept per page rather than in a
			 * store service: it is presentation memory (the order tabs were
			 * engaged in, so they do not reshuffle), and losing it on reload costs
			 * nothing — the engaged set is recomputed from the host's own `blank`
			 * bit, which is durable.
			 */
			const derived = stepTabs({
				ids: list.ids,
				byId: list.byId,
				current: sessionId,
				order: engagementOrder
			});
			const visible = derived.ids.filter((id) => !dismissedTabs.has(id));
			/*
			 * Remember the whole engagement order, never just the tabs on screen: a
			 * truncated memory is not a fixed point (the next render derives its
			 * window from it, stores that window, and the one after derives from
			 * that), which rotated the strip under the pointer on every re-render —
			 * and typing re-renders it constantly. `stepTabs` owns that rule, and
			 * verify.mjs replays this exact loop to prove it stands still.
			 */
			engagementOrder = derived.order;
			/*
			 * Persist whatever this render derived. Identical snapshots never write, and a
			 * store that refuses only costs the memory — never the strip.
			 */
			react.useEffect(() => {
				const snapshot = memorySnapshot();
				if (snapshot === savedSnapshot) return;
				if (writeMemory(globalThis.localStorage, snapshot)) savedSnapshot = snapshot;
			});

			const tabs = visible.map((id) => {
				const summary = list.byId[id];
				const title = summary?.displayTitle ?? id;
				return {
					id,
					title,
					label: chipLabel(title),
					active: id === sessionId,
					running: summary?.running === true
				};
			});

			/* A strip holding one tab is still worth showing: it names the current
			 * session and carries its running dot. */
			const closableFor = (id) => tabs.length > 1 && id !== derived.preview;

			const stripRef = react.useRef(null);
			const [menu, setMenu] = react.useState(void 0);
			const [renaming, setRenaming] = react.useState(void 0);
			/*
			 * A plain wheel over the strip scrolls it sideways. React's `onWheel` is
			 * registered passively, so `preventDefault` there is ignored: this is a
			 * native listener, `{ passive: false }`. When the strip has nothing to
			 * scroll the event is left alone, so the transcript still scrolls.
			 */
			react.useEffect(() => {
				const node = stripRef.current;
				if (node === null) return void 0;
				const onWheel = (event) => {
					const delta = scrollStep(event, node.scrollWidth > node.clientWidth);
					if (delta === 0) return;
					event.preventDefault();
					node.scrollLeft += delta;
				};
				node.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					node.removeEventListener("wheel", onWheel);
				};
			});
			/*
			 * Keep the active chip in view when the selection changes (and on mount),
			 * so a long strip always opens on the session being read. Only the active
			 * id is a dependency: a re-render must not yank the strip back while the
			 * reader is scrolling through the other tabs.
			 */
			const activeId = (tabs.find((tab) => tab.active) ?? {}).id;
			react.useEffect(() => {
				const node = stripRef.current;
				if (node === null) return void 0;
				const active = node.querySelector('[data-active="true"]');
				if (active === null) return void 0;
				active.scrollIntoView({
					block: "nearest",
					inline: "nearest"
				});
				return void 0;
			}, [activeId]);

			/*
			 * Bulk closes act on the strip only: they dismiss tabs, never sessions, and
			 * the right-clicked tab is never among them. When the tab being read is
			 * closed by one, the conversation follows the tab that was kept, so the strip
			 * and the transcript cannot disagree about which session is up.
			 */
			const closeRange = (id, side) => {
				const doomed = closeRangeIds(tabs, id, side);
				if (doomed.length === 0) return;
				for (const doomedId of doomed) dismissedTabs.add(doomedId);
				if (doomed.includes(sessionId)) props.open(id);
				setDismissTicket((ticket) => ticket + 1);
			};
			/*
			 * Renaming is committed through the sessions service, which updates the title
			 * projection the strip already reads. A refusal leaves the old title in place.
			 */
			const commitRename = (id, title) => {
				setRenaming(void 0);
				const trimmed = typeof title === "string" ? title.trim() : "";
				if (trimmed === "") return;
				props.rename(id, trimmed);
			};
			const menuItems = menu === undefined ? [] : contextMenuRows(tabs.length, tabs.findIndex((tab) => tab.id === menu.id)).map((row) => ({
				id: row.id,
				label: row.label,
				disabled: row.disabled === true,
				separatorBefore: row.separatorBefore === true,
				icon: row.kind === "rename" ? react_jsx_runtime.jsx(primitives.IconEditOutlineRegular, { size: 14 }) : void 0,
				onSelect: () => {
					if (row.kind === "rename") setRenaming(menu.id);
					else closeRange(menu.id, row.side);
				}
			}));

			/* Every hook is above this line: a strip with nothing to show must not
			 * change the hook count between renders. */
			if (tabs.length === 0) return null;

			const strip = react_jsx_runtime.jsx("div", {
				ref: stripRef,
				"data-session-tabs": "",
				style: {
					display: "flex",
					alignItems: "flex-end",
					gap: 2,
					width: "100%",
					minWidth: 0,
					boxSizing: "border-box",
					/*
					 * No `scrollbar-width`/`scrollbar-color` here, deliberately. Chromium
					 * then uses the shell's themed `::-webkit-scrollbar` rules (ui-theme
					 * installs them unscoped: `--dsh-scrollbar-width`, a rounded thumb in
					 * `--dsw-alias-scrollbar-bg-l1`, and a hover colour), so the strip's bar
					 * matches the transcript's. Setting the standard properties opts that
					 * element out of them and brings back the fat native macOS bar.
					 */
					overflowX: "auto",
					overflowY: "hidden",
					/*
					 * The frame of a Chrome-style strip: a bar slightly off the pane's own
					 * surface, with the tabs sitting on a hairline rail along its bottom.
					 * No `padding-bottom`, so a chip's box reaches the rail.
					 *
					 * The fill is a translucent neutral rather than a surface token: the
					 * shell's own surfaces are *lighter* than the pane in dark mode
					 * (`--dsw-alias-bg-base` is the pane, `…-layer-1…3` are raised above it),
					 * so a token fill would either erase the bar in one theme or paint a
					 * raised card in the other. A 12% neutral reads as a raised bar on the
					 * dark pane and a recessed one on the light pane, from one value.
					 */
					padding: "6px 28px 0 20px",
					backgroundColor: "rgba(127,127,127,0.12)",
					/*
					 * The rail is the strip's *own* bottom row of background, not a
					 * `border-bottom`: a child cannot paint over its parent's border, and the
					 * strip clips its overflow, so the active chip could never cover a border
					 * to merge with the row beneath it. Painted as background, the chips —
					 * which are children — are composited on top, so the active chip's opaque
					 * fill hides the rail under itself and the tab connects to the pane below,
					 * exactly as the row's inactive gaps keep the rail.
					 */
					backgroundImage: "linear-gradient(to top, var(--dsw-alias-border-l2) 0 1px, transparent 1px)",
					backgroundRepeat: "no-repeat"
				},
				children: tabs.map((tab) => react_jsx_runtime.jsx(TabChip, {
					id: tab.id,
					label: tab.label,
					title: tab.title,
					active: tab.active,
					running: tab.running,
					closable: closableFor(tab.id),
					renaming: renaming === tab.id,
					onSelect: () => props.open(tab.id),
					onRenameCommit: (title) => commitRename(tab.id, title),
					onRenameCancel: () => setRenaming(void 0),
					onContextMenu: (x, y) => {
						setRenaming(void 0);
						setMenu({
							id: tab.id,
							x,
							y
						});
					},
					/*
					 * Closing drops the tab from the strip; the session itself is
					 * the sidebar's to delete. Closing the active tab selects a
					 * neighbour first, so the strip is never left pointing at a
					 * session it no longer shows.
					 */
					onClose: () => {
						if (tab.id === sessionId) {
							const fallback = tabs.find((other) => other.id !== tab.id);
							if (fallback !== undefined) props.open(fallback.id);
						}
						dismissedTabs.add(tab.id);
						setDismissTicket((ticket) => ticket + 1);
					}
				}, tab.id))
			});
			if (menu === undefined) return strip;
			return react_jsx_runtime.jsxs(react.Fragment, { children: [strip, react_jsx_runtime.jsx(ContextMenu, {
				x: menu.x,
				y: menu.y,
				items: menuItems,
				onClose: () => setMenu(void 0)
			})] });
		}
		//#endregion

		//#region placement
		/**
		 * Anchor the strip's host row at the very top of the conversation column.
		 *
		 * The app declares no seat there: `conversation.header` is a single seat owned
		 * by the shipped conversation plugin, and its one free child
		 * (`conversation.header.leading`) sits *inside* the title bar. So the strip is
		 * registered in `conversation.input.dock` — a list seat that always renders and
		 * hands an entry the full session props — and this function moves its element
		 * into a row of our own, ahead of every row the column already has: the tab
		 * strip becomes the first thing in the conversation, above the title row and
		 * the Chat/Trajectory view tabs, with the transcript below.
		 *
		 * The shape relied on is the column the shipped bundle renders — `div.root`, a
		 * flex column whose children are the header and `div[data-conversation-content]`
		 * — reached from the seat's own placeholder, so it is the column the seat
		 * actually belongs to and never another occurrence's.
		 *
		 * @param node - the seat's placeholder element, inside the conversation column.
		 * @returns the host row, `null` in an embedded occurrence (a subagent preview,
		 * which has no header of its own and so no top to claim), or `undefined` when
		 * the conversation shape is not recognized and the strip must stay where the
		 * seat put it.
		 */
		function anchorStripHost(node) {
			if (node === null || node === void 0) return void 0;
			const content = node.closest("[data-conversation-content]");
			if (content === null) return void 0;
			/* An embedded occurrence (a subagent preview) has no resident header of its
			 * own, and the shipped bundle marks it on the content element itself. */
			const classes = content.classList;
			if (classes !== void 0 && Array.from(classes).some((name) => name.endsWith("_embeddedBody"))) return null;
			/* Slot outlets are `display: contents` anchors (`div[data-slot=…]`), and the
			 * Factory outlet adds no wrapper of its own, so the content element is a
			 * direct child of the conversation column. The column itself is a flex
			 * column, so one more child ahead of the rest is simply the first row. */
			const boundary = content.closest('[data-slot="conversation.content"]') ?? content;
			const column = boundary.parentElement;
			if (column === null || column === void 0) return void 0;
			const children = Array.from(column.children);
			const index = children.indexOf(boundary);
			const header = index < 0 ? void 0 : children.slice(0, index).find((child) => child.tagName === "HEADER" || child.querySelector("header") !== null);
			if (header === void 0) return void 0;
			const host = node.ownerDocument.createElement("div");
			host.setAttribute("data-session-tabs-host", "");
			/* `flex: none` so the column's own flex layout keeps its height. The row is
			 * now a bare full-width box: the tab frame, its rail and the padding that
			 * lines the chips up with the header's content box all belong to the strip
			 * itself, because only the strip can paint its own background *behind* the
			 * chips — which is what lets the active chip cover the rail. */
			host.style.cssText = "flex:none;display:flex;align-items:stretch;min-width:0;width:100%;padding:0";
			column.insertBefore(host, column.firstElementChild);
			return host;
		}
		//#endregion

		//#region registration
		/** Required services: the UI slot registry and the session navigation face. */
		const inject = ["slots", "sessions"];

		/**
		 * The strip's seat: the composer dock, rendering into the anchored top row.
		 *
		 * The dock is where the entry is *registered* — it is additive (a fresh id
		 * beside the todo, queue, and goal docks) and gives the strip the session
		 * props it needs. Where the strip is *drawn* is the row this component anchors
		 * at the top of the conversation column, so the tabs are the first thing in the
		 * conversation rather than a row above the composer.
		 *
		 * Three outcomes, in order of preference:
		 *
		 * - the host anchored: the strip is portaled into it, at the top;
		 * - the conversation shape is unrecognized: the strip renders in the dock
		 *   itself, i.e. exactly where the entry was registered — nothing is lost;
		 * - an embedded occurrence (a subagent preview, which has no header row):
		 *   the strip draws nothing, since a dock strip there would be noise.
		 *
		 * The host is re-anchored whenever it leaves the document, so a re-render of
		 * the conversation column cannot strand the strip in a detached node.
		 *
		 * @param props - standard session hooks plus the bound tab actions.
		 * @returns the placeholder, and the strip at whatever placement was found.
		 */
		function DockSeat(props) {
			const placeholder = react.useRef(null);
			const hostRef = react.useRef(void 0);
			const [, bump] = react.useState(0);
			/* Runs after every render: a live host needs nothing, a missing or detached
			 * one is re-anchored exactly once (the comparison below stops the loop when
			 * the outcome is unchanged). */
			react.useEffect(() => {
				const current = hostRef.current;
				if (current !== void 0 && current !== null && current.isConnected === true) return;
				const next = anchorStripHost(placeholder.current);
				if (next !== current) {
					hostRef.current = next;
					bump((value) => value + 1);
				}
			});
			/* The host is ours, not React's: remove it when the seat unmounts. */
			react.useEffect(() => () => {
				const host = hostRef.current;
				hostRef.current = void 0;
				if (host !== void 0 && host !== null) host.remove();
			}, []);
			const strip = react_jsx_runtime.jsx(SessionTabs, props);
			const host = hostRef.current;
			return react_jsx_runtime.jsxs(react.Fragment, { children: [
				react_jsx_runtime.jsx("span", {
					ref: placeholder,
					hidden: true,
					"data-session-tabs-anchor": ""
				}),
				host === void 0 ? strip : host === null ? null : react_dom.createPortal(strip, host)
			]});
		}

		/**
		 * Register the strip in `conversation.input.dock`.
		 *
		 * Declaration order is why this goes through `slots.inject`: the dock is
		 * declared by the Conversation Factory, which mounts after this plugin's own
		 * two services resolve. A bare `register()` here throws
		 * `slot "conversation.input.dock" is not declared` and fails the whole fiber
		 * at web boot — which is exactly how claiming the single `conversation.header`
		 * seat broke the boot instead of stacking the strip over the title row.
		 *
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			/*
			 * Session switching is `uiWorkspace.openSession` — exactly what the shipped
			 * conversation header calls for the same action. It is NOT
			 * `ctx.sessions.open`: the sessions service has no such method (its `open()`
			 * belongs to one session's data stream and takes no id), so every chip click
			 * threw and the tabs looked dead next to a sidebar that navigates fine.
			 *
			 * The service is looked up per click instead of injected, so a profile that
			 * disables the workspace UI cannot leave this fiber pending and stall web
			 * boot; a missing service degrades to a click that does nothing.
			 */
			const open = (id) => {
				const navigation = ctx.get("uiWorkspace");
				if (navigation === void 0 || navigation === null) return;
				if (typeof navigation.openSession !== "function") return;
				navigation.openSession(id);
			};
			/*
			 * Renaming goes through the sessions service, whose `rename(sessionId, title)`
			 * updates the title projection the strip already reads. Looked up per call and
			 * guarded for the same reason as navigation: a profile without the service must
			 * cost a click, not a fiber.
			 */
			const rename = (id, title) => {
				const sessions = ctx.get("sessions");
				if (sessions === void 0 || sessions === null) return;
				if (typeof sessions.rename !== "function") return;
				const result = sessions.rename(id, title);
				if (result === void 0 || result === null) return;
				if (typeof result.catch === "function") result.catch((reason) => {
					console.warn("session-tabs: rename was refused:", reason);
				});
			};
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "session-tabs",
				order: 10
			}, (props) => react_jsx_runtime.jsx(DockSeat, {
				...props,
				open,
				rename
			})));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		/** Exposed for verify.mjs: the pure policy, asserted without the DOM. */
		exports.__internals = {
			anchorStripHost,
			deriveTabs,
			stepTabs,
			chipLabel,
			fitLabel,
			graphemes,
			nodeMeasurer,
			isEngaged,
			isTabCandidate,
			clearsDismissal,
			closeRangeIds,
			contextMenuRows,
			TabChip,
			closeRangeAvailability,
			closeControlStyle,
			TAB_WIDTH,
			LABEL_SAFETY,
			/** Test hook: forget every dismissal and the remembered order. */
			readMemory,
			writeMemory,
			memorySnapshot,
			resetMemory: () => {
				dismissedTabs.clear();
				engagementOrder = [];
				savedSnapshot = "";
			},
			scrollStep
		};
		return module.exports;
	}
});
