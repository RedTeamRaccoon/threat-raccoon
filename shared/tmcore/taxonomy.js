import { v4 as uuidv4 } from 'uuid';

// i18n/Vuex-decoupled port of td.vue/src/service/threats/index.js.
// Raw English category constants only — no tc(), no Vuex store.

// Threat categories per framework (mirrors threats.model.* in td.vue/src/i18n/en.js).
export const categoriesByModelType = {
    STRIDE: ['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege'],
    CIA: ['Confidentiality', 'Integrity', 'Availability'],
    CIADIE: ['Confidentiality', 'Integrity', 'Availability', 'Distributed', 'Immutable', 'Ephemeral'],
    LINDDUN: ['Linkability', 'Identifiability', 'Non-repudiation', 'Detectability', 'Disclosure of information', 'Unawareness', 'Non-compliance'],
    PLOT4ai: ['Technique & Processes', 'Accessibility', 'Identifiability & Linkability', 'Security', 'Safety', 'Unawareness', 'Ethics & Human Rights', 'Non-compliance'],
    EOP: ['Data Validation & Encoding', 'Authentication', 'Session Management', 'Authorization', 'Cryptography', 'Cornucopia', 'Wild Card']
};

// Generic threat titles per framework (mirrors threats.generic.* in en.js).
const genericTitles = {
    default: 'New generic threat',
    CIA: 'New CIA threat',
    CIADIE: 'New CIA-DIE threat',
    LINDDUN: 'New LINDDUN threat',
    PLOT4ai: 'New PLOT4ai threat',
    STRIDE: 'New STRIDE threat',
    EOP: 'New EoP threat'
};

const DEFAULT_DESCRIPTION = 'Provide a description for this threat';
const DEFAULT_MITIGATION = 'Provide remediation for this threat or a reason if status is N/A';

/**
 * Normalize a caller-supplied modelType to a canonical framework key,
 * matching the logic in createNewTypedThreat.
 */
export function normalizeModelType(modelType) {
    if (!modelType) {
        return 'STRIDE';
    }
    if (modelType.toLowerCase() === 'generic') {
        return 'default';
    }
    if (modelType === 'DIE') {
        return 'CIADIE';
    }
    return modelType;
}

/**
 * Default threat category for a (modelType, cellType) pair — the i18n-decoupled
 * port of the switch in createNewTypedThreat.
 * @returns {{ title: string, type: string }}
 */
export function defaultCategory(modelType, cellType) {
    const normalized = normalizeModelType(modelType);

    switch (normalized) {
    case 'CIA':
        return { title: genericTitles.CIA, type: 'Confidentiality' };
    case 'CIADIE':
        return { title: genericTitles.CIADIE, type: 'Distributed' };
    case 'LINDDUN':
        return { title: genericTitles.LINDDUN, type: 'Linkability' };
    case 'PLOT4ai':
        return {
            title: genericTitles.PLOT4ai,
            type: cellType === 'tm.Actor' ? 'Accessibility' : 'Technique & Processes'
        };
    case 'STRIDE':
        return {
            title: genericTitles.STRIDE,
            type: (cellType === 'tm.Actor' || cellType === 'tm.Process') ? 'Spoofing' : 'Tampering'
        };
    case 'EOP':
        return { title: genericTitles.EOP, type: 'cornucopia' };
    default:
        return { title: genericTitles.default, type: 'Spoofing' };
    }
}

/**
 * Build a typed threat object (decoupled port of createNewTypedThreat).
 * Defaults follow the (modelType, cellType) taxonomy; any field can be overridden.
 * @param {{ modelType?: string, cellType?: string, number: number,
 *           title?: string, type?: string, severity?: string, status?: string,
 *           description?: string, mitigation?: string }} args
 * @returns {object} threat — { id, title, status, severity, type, description, mitigation, modelType, number, score }
 */
export function createTypedThreat({ modelType, cellType, number, ...overrides }) {
    const normalized = normalizeModelType(modelType);
    const { title, type } = defaultCategory(modelType, cellType);

    return {
        id: uuidv4(),
        title: overrides.title ?? title,
        status: overrides.status ?? 'Open',
        severity: overrides.severity ?? 'TBD',
        type: overrides.type ?? type,
        description: overrides.description ?? DEFAULT_DESCRIPTION,
        mitigation: overrides.mitigation ?? DEFAULT_MITIGATION,
        modelType: normalized,
        number,
        score: overrides.score ?? ''
    };
}

const taxonomy = {
    categoriesByModelType,
    normalizeModelType,
    defaultCategory,
    createTypedThreat
};

export default taxonomy;
