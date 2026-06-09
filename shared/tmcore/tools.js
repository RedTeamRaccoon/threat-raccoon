// Single source of truth for LLM `input_schema` and MCP tool registration.
// One entry per ops key (name === ops key). JSON Schema restricted to features
// AJV + Anthropic structured tools both support: object/array/string/number/
// boolean/enum, additionalProperties:false, required.

const positionSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        x: { type: 'number', description: 'Horizontal canvas position' },
        y: { type: 'number', description: 'Vertical canvas position' }
    },
    required: ['x', 'y']
};

const sizeSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        width: { type: 'number', description: 'Width in pixels (min 10)' },
        height: { type: 'number', description: 'Height in pixels (min 10)' }
    },
    required: ['width', 'height']
};

const pointSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        x: { type: 'integer' },
        y: { type: 'integer' }
    },
    required: ['x', 'y']
};

export const toolDefinitions = [
    {
        name: 'createDiagram',
        description: 'Create a new data-flow diagram in the threat model. Call this FIRST, before adding any elements, when the model has no suitable diagram for the methodology you intend to use. Returns the new diagramId that all subsequent element/flow/threat calls must reference.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: { type: 'string', description: 'Human-readable diagram title' },
                diagramType: {
                    type: 'string',
                    enum: ['STRIDE', 'CIA', 'CIADIE', 'LINDDUN', 'PLOT4ai', 'EOP'],
                    description: 'Threat-modeling methodology for this diagram; drives default threat categories'
                }
            },
            required: ['title', 'diagramType']
        }
    },
    {
        name: 'addElement',
        description: 'Add an actor, process, or data store node to a diagram. Call this for each distinct system component (users, services, databases) before connecting them with flows. Returns the new cellId used to reference this element in flows, threats, and updates.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Target diagram id from createDiagram' },
                kind: {
                    type: 'string',
                    enum: ['actor', 'process', 'store'],
                    description: 'actor = external entity/user; process = compute/service; store = data store/database'
                },
                name: { type: 'string', description: 'Element name shown on the canvas' },
                position: positionSchema,
                description: { type: 'string', description: 'Optional notes about the element' },
                properties: {
                    type: 'object',
                    description: 'Optional element data flags to override (e.g. outOfScope, isWebApplication, storesCredentials)',
                    additionalProperties: true
                }
            },
            required: ['diagramId', 'kind', 'name', 'position']
        }
    },
    {
        name: 'connectFlow',
        description: 'Connect two existing elements with a directional data flow (edge). Call this AFTER both the source and target elements exist. Represents data moving from source to target; create two flows for bidirectional communication. Give the flow a short, descriptive name of the data it carries (e.g. "OAuth login redirect") — never leave it as the generic "Data Flow". Set protocol/isEncrypted/isPublicNetwork when known, as they drive threat severity.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Target diagram id' },
                sourceId: { type: 'string', description: 'cellId of the element data flows FROM' },
                targetId: { type: 'string', description: 'cellId of the element data flows TO' },
                name: { type: 'string', description: 'Optional flow label (e.g. "HTTPS request")' },
                protocol: { type: 'string', description: 'Optional protocol (e.g. HTTPS, gRPC, SQL)' },
                properties: {
                    type: 'object',
                    description: 'Optional flow data flags (e.g. isEncrypted, isPublicNetwork)',
                    additionalProperties: true
                }
            },
            required: ['diagramId', 'sourceId', 'targetId']
        }
    },
    {
        name: 'addBoundary',
        description: 'Add a trust boundary to a diagram to mark where the level of trust changes (e.g. internet vs. internal network). Use kind "box" to enclose a region or "curve" to draw a dividing line between two points. Trust boundaries do not connect elements; they group or separate them.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Target diagram id' },
                kind: {
                    type: 'string',
                    enum: ['box', 'curve'],
                    description: 'box = rectangular region (uses position+size); curve = dividing line (uses source+target points)'
                },
                name: { type: 'string', description: 'Optional boundary label' },
                position: positionSchema,
                size: sizeSchema,
                source: pointSchema,
                target: pointSchema
            },
            required: ['diagramId', 'kind']
        }
    },
    {
        name: 'addThreat',
        description: 'Attach a threat to a specific element or flow. Be thorough: cover the STRIDE categories that apply to the target type (actors: spoofing/repudiation; processes: all six; stores: tampering/repudiation/info-disclosure/DoS; flows: tampering/info-disclosure/DoS) rather than one threat per element. Write a description that names the element and why it is at risk, set a justified severity, and give a concrete actionable mitigation (not "use encryption"). Omitted fields fall back to the methodology defaults. Increments the threat counter and marks the element as having open threats.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Diagram containing the target element' },
                cellId: { type: 'string', description: 'cellId of the element/flow this threat applies to' },
                threat: {
                    type: 'object',
                    additionalProperties: false,
                    description: 'Threat details; any field may be omitted to accept a methodology default',
                    properties: {
                        title: { type: 'string', description: 'Short threat title' },
                        type: { type: 'string', description: 'Threat category, e.g. "Spoofing" for STRIDE' },
                        severity: {
                            type: 'string',
                            enum: ['High', 'Medium', 'Low', 'TBD'],
                            description: 'Threat severity'
                        },
                        status: {
                            type: 'string',
                            enum: ['Open', 'Mitigated', 'NA'],
                            description: 'Threat status'
                        },
                        description: { type: 'string', description: 'What the threat is' },
                        mitigation: { type: 'string', description: 'How to remediate the threat' },
                        modelType: {
                            type: 'string',
                            enum: ['STRIDE', 'CIA', 'CIADIE', 'LINDDUN', 'PLOT4ai', 'EOP'],
                            description: 'Methodology; defaults to the diagram type'
                        }
                    },
                    required: []
                }
            },
            required: ['diagramId', 'cellId', 'threat']
        }
    },
    {
        name: 'updateElement',
        description: 'Modify an existing element or flow in place — rename it, move it, resize it, change its description, or set data flags. Use this instead of removing and re-adding when an element already exists.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Diagram containing the element' },
                cellId: { type: 'string', description: 'cellId of the element to update' },
                patch: {
                    type: 'object',
                    additionalProperties: false,
                    description: 'Fields to change; omitted fields are left untouched',
                    properties: {
                        name: { type: 'string' },
                        description: { type: 'string' },
                        position: positionSchema,
                        size: sizeSchema,
                        properties: {
                            type: 'object',
                            description: 'Element data flags to merge',
                            additionalProperties: true
                        }
                    },
                    required: []
                }
            },
            required: ['diagramId', 'cellId', 'patch']
        }
    },
    {
        name: 'removeElement',
        description: 'Delete an element or flow from a diagram. When deleting a node, any flows connected to it are pruned automatically. Returns the ids of everything removed. Use sparingly — prefer updateElement to correct mistakes.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Diagram containing the element' },
                cellId: { type: 'string', description: 'cellId of the element to remove' }
            },
            required: ['diagramId', 'cellId']
        }
    },
    {
        name: 'listThreats',
        description: 'List the threats currently in the model, optionally scoped to one diagram and filtered. Call this to review existing coverage before adding more threats, or to report what has been identified. Does not modify the model.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagramId: { type: 'integer', description: 'Optional: restrict to this diagram id' },
                filters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        showOutOfScope: { type: 'boolean', description: 'Include threats on out-of-scope elements (default false)' },
                        showMitigated: { type: 'boolean', description: 'Include mitigated threats (default false)' }
                    },
                    required: []
                }
            },
            required: []
        }
    },
    {
        name: 'validateModel',
        description: 'Validate the entire threat model against the Threat Dragon v2 schema. Call this after a batch of changes, and always before finishing, to confirm the model is well-formed. Returns valid:true or the list of schema errors.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: []
        }
    },
    {
        name: 'getModelSummary',
        description: 'Get a compact overview of the model: each diagram with its element and threat counts, plus totals and a severity breakdown. Call this FIRST to understand the current state before making changes, and at the end to report results.',
        input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: []
        }
    }
];
