/**
 * Session tabs, node half.
 *
 * The strip is pure browser presentation computed from the session list the
 * client already holds, so this half is the empty `apply` that gives the Loader
 * a host-side row while the browser half ships through `exports["./client"]`.
 */

/** Host plugin body — this package contributes browser presentation only. */
function apply() {}

export { apply };
