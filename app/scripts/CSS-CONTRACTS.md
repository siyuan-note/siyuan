# CSS contracts

`pnpm run css:check` checks core UI class literals and Stylelint rules. `pnpm run lint` runs it after type checking and ESLint. The frontend test command also discovers `css-contracts.test.js`.

The class check compiles the desktop, mobile, and export SCSS entries and reads bundled appearance CSS and complete CSS rule literals injected by TypeScript. It collects complete static HTML class attributes, `className`, `setAttribute("class", ...)`, `classList` mutations and queries, and selector literals from TypeScript and templates. Core namespaces include BEM names, `b3-`, `config-`, `agent-chat__`, `protyle-`, and tab classes. Dynamically composed names and third-party content classes cannot be fully enumerated by this check.

`css-contract-baseline.json` retains existing classes without built-in CSS and existing style findings. Class entries include their source locations and a reason; classes used for behavior or external theme customization do not require their own built-in rule. The style baseline preserves existing cascade behavior, nested feature scopes, and the bundled PDF styles. New violations fail even when the same style finding already occurs elsewhere, because the style baseline counts occurrences.

Remove baseline entries when their underlying finding is resolved. Do not regenerate or expand the baseline to make a failure pass. A new exception requires a concrete reason in the same reviewed change, identifying the behavior, external theme contract, or required cascade compatibility. Keep reasons and source references current when moving code.

`pnpm run css:unused` produces a read-only list of defined core classes without a recognized literal reference. Investigate templates, runtime composition, Lute output, and external theme/plugin usage before acting on that report; absence from it or presence in it is not proof of usage or obsolescence.

Fallback defaults shared by feature styles live in `src/assets/scss/util/_tokens.scss`. The `token()` function emits the fallback at the consumption site so descendant theme overrides and element-specific runtime values keep their original resolution semantics. Shared component appearance continues to use the existing component styles and theme tokens.
