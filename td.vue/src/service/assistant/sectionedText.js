/**
 * @name sectionedText
 * @description Shared chunking for long document text. Extracted text is split
 * into sections of at most a byte budget (capped at a maximum section count —
 * content beyond the cap is genuinely truncated). Section 1 rides in the text
 * attachment's `data`; sections 2..N ride along in `pendingSections` so the
 * send pipeline can feed them to the agent one at a time, using the threat
 * model itself (re-injected into every request's system prompt) as the memory
 * that carries continuity between sections.
 */

// one section must fit comfortably in a single request even for CJK documents
// on 128K-token models
export const CHUNK_BUDGET_BYTES = 150 * 1024;
// beyond this many sections the document is genuinely truncated
export const MAX_SECTIONS = 8;

/**
 * Creates an accumulator that packs labelled text entries (one per page,
 * paragraph block, …) into byte-budgeted sections.
 * @param {{ chunkBudget?: Number, maxSections?: Number }} [options]
 * @returns {{ add: Function, finish: Function, isTruncated: Function }}
 */
export const createSectionBuilder = ({ chunkBudget = CHUNK_BUDGET_BYTES, maxSections = MAX_SECTIONS } = {}) => {
    const rawSections = [];
    let current = null;
    let truncated = false;

    return {
        /**
         * Adds one entry; `unit` is the entry's position (page or block number)
         * used for the section's range label.
         * @param {Number} unit
         * @param {String} entry
         * @returns {Boolean} false once the section cap has been hit
         */
        add(unit, entry) {
            if (truncated) {
                return false;
            }
            if (current && current.bytes + entry.length > chunkBudget) {
                rawSections.push(current);
                current = null;
                if (rawSections.length >= maxSections) {
                    truncated = true;
                    return false;
                }
            }
            if (!current) {
                current = { start: unit, end: unit, parts: [], bytes: 0 };
            }
            current.parts.push(entry);
            current.bytes += entry.length;
            current.end = unit;
            return true;
        },
        isTruncated() {
            return truncated;
        },
        /**
         * @returns {{ sections: Object[], total: Number, truncated: Boolean, lastUnit: Number }}
         */
        finish() {
            if (current) {
                rawSections.push(current);
                current = null;
            }
            const total = rawSections.length;
            return {
                total,
                truncated,
                lastUnit: total ? rawSections[total - 1].end : 0,
                sections: rawSections.map((section, idx) => ({
                    index: idx + 1,
                    total,
                    pageRange: `${section.start}-${section.end}`,
                    text: section.parts.join('\n\n')
                }))
            };
        }
    };
};

/**
 * Assembles the text attachment from built sections: section 1 in `data` (with
 * a continuation marker when more follow), sections 2..N in `pendingSections`.
 * @param {Object[]} sections as returned by finish()
 * @param {String} name the document file name (also the chip group)
 * @returns {Object} the text attachment
 */
export const toTextAttachment = (sections, name) => {
    const total = sections.length;
    let firstText = total ? sections[0].text : '';
    if (total > 1) {
        firstText += `\n\n[Document continues: section 1 of ${total}. Later sections will follow in this conversation.]`;
    }
    const attachment = { kind: 'text', mediaType: 'text/plain', name, group: name, data: firstText };
    if (total > 1) {
        attachment.pendingSections = sections.slice(1);
    }
    return attachment;
};

export default { createSectionBuilder, toTextAttachment, CHUNK_BUDGET_BYTES, MAX_SECTIONS };
