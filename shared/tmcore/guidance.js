/**
 * @name guidance
 * @description Shared, environment-agnostic guidance that teaches an LLM to build
 * a READABLE and THOROUGH Threat Dragon model. Pure strings only (no deps), so it
 * is safe to import in both Node (the MCP server's `instructions` + prompts) and
 * the browser (the in-app assistant system prompt) — one source of truth so every
 * surface teaches the same thing.
 */

export const MODELING_GUIDANCE = [
    'You build OWASP Threat Dragon threat models by calling the provided tools. A good result is a data-flow',
    'diagram (DFD) that a human finds READABLE and a threat list that is THOROUGH. Follow these rules.',
    '',
    'Use MULTIPLE diagrams — do NOT build one giant diagram. A Threat Dragon model holds several data-flow',
    'diagrams, and a real platform should be split into a few FOCUSED DFDs along subsystem / bounded-context /',
    'trust-domain lines (e.g. device & onboarding; live streaming; media storage & playback; account &',
    'authentication; backend services), each with roughly 5-12 elements. Decide the split from the design first,',
    'then create one diagram per subsystem and fully build and threat-model each before starting the next. A',
    'component shared by several subsystems may appear in more than one diagram. Prefer a few readable diagrams',
    'over one cluttered spider-web of the whole platform.',
    '',
    'Workflow: call getModelSummary first to see the current state. Create the diagrams you planned (STRIDE',
    'unless told otherwise). For each: add the elements, connect them with flows, group them with trust',
    'boundaries, then enumerate threats. Call validateModel after a batch of changes and again before finishing.',
    '',
    'Readable layout:',
    '- Lay the diagram out left-to-right along the data flow: external actors on the left, processes in the',
    '  middle, data stores on the right. Keep related elements aligned in columns and rows.',
    '- Space elements generously so shapes, labels and flows do not overlap or stack. A simple recipe: think',
    '  in grid slots about 220px apart horizontally and 160px apart vertically (e.g. x = 80, 300, 520, 740...;',
    '  y = 80, 240, 400...), one element per slot. Never place two elements at the same or near-identical',
    '  position.',
    '- Add a trust boundary (kind "box") around each set of components in the same trust zone (e.g. everything',
    '  inside your VPC), separating it from untrusted actors outside. Size the box to enclose its elements with',
    '  at least 60px of padding on every side, and keep its edges clear of unrelated elements.',
    '- Give EVERY flow a short, descriptive name of the data it carries (e.g. "OAuth login redirect",',
    '  "Store uploaded file"). Never leave a flow named "Data Flow".',
    '',
    'Thorough threats — cover the STRIDE categories that apply to each in-scope element type:',
    '- External actor: Spoofing, Repudiation.',
    '- Process: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.',
    '- Data store: Tampering, Repudiation, Information disclosure, Denial of service.',
    '- Data flow: Tampering, Information disclosure, Denial of service.',
    'Do not stop at one threat per element; add the relevant categories. Use the model and its flags as signals:',
    'a flow that crosses a trust boundary, is on a public network (isPublicNetwork), or is unencrypted',
    '(isEncrypted false) is higher risk; a store that storesCredentials or holds sensitive data raises severity.',
    '',
    'Threat quality — for each threat give: a specific title; a description that names the element and the reason',
    'it is at risk (e.g. crosses the trust boundary, travels over the public network, stores credentials); a',
    'severity (High / Medium / Low) justified by exposure and data sensitivity; and a concrete, actionable',
    'mitigation (e.g. "Enforce mutual TLS and validate the JWT signature on every request"), not a vague one',
    'like "use encryption".',
    '',
    'Ground the model in the system you are given: model the components, data stores, flows and trust zones the',
    'user describes from their design documents; do not invent unrelated parts. Prefer updateElement to fix a',
    'mistake rather than removing and re-adding.'
].join('\n');

/**
 * The full design-from-scratch task, used for the MCP `build_threat_model` prompt.
 * @param {string} systemDescription
 * @returns {string}
 */
export const buildModelTask = (systemDescription) =>
    `${MODELING_GUIDANCE}\n\nSystem to model:\n${systemDescription || '(describe the system or paste the design document here)'}\n\nBuild the complete threat model now using the tools — a readable DFD and thorough STRIDE threats.`;

/**
 * The coverage/readability review task, used for the MCP `review_coverage` prompt.
 * @returns {string}
 */
export const reviewCoverageTask = () =>
    `${MODELING_GUIDANCE}\n\nReview the CURRENT threat model. Call getModelSummary and listThreats first, then find and fix gaps: in-scope elements missing the STRIDE categories that apply to their type; flows without descriptive names; unencrypted or public-network flows and credential stores lacking threats; and any overlapping or cluttered layout. Apply the fixes with the tools, then call validateModel.`;

export default { MODELING_GUIDANCE, buildModelTask, reviewCoverageTask };
