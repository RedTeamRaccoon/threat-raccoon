# `shared/tmcore` — frozen interface contract

This is the **single seam** the AI assistant + MCP server are built against. All three workstreams (tmcore, td.server backend, td.vue frontend) code to THIS interface. Do not change a signature here without telling the team lead — other agents depend on it.

## Module & format

- Location: `/data/repos/threat-raccoon/shared/tmcore/`
- ESM source (`import`/`export`), consistent with the rest of the repo (Babel transpiles it in each consumer).
- Dependencies only: `ajv`, `ajv-formats`, `uuid`.
- Consumers import via alias `@tmcore` (td.vue webpack + jest) or relative path (`../../shared/tmcore`, td.server/desktop).

## Exports (`shared/tmcore/index.js` barrel)

```js
export { ops } from './ops.js';                 // the operations registry (below)
export { toolDefinitions } from './tools.js';   // LLM/MCP tool schemas (below)
export { validateModel } from './validate.js';  // AJV v2 validation
export { default as taxonomy } from './taxonomy.js'; // decoupled threat taxonomy
```

## Threat-model document shape (TD v2 — authoritative)

```
model = {
  version: "2.0",
  summary: { title, owner, description, id },
  detail: {
    contributors: [{ name }],
    diagrams: [ Diagram ],
    diagramTop: <int>,   // next diagram id counter
    reviewer,
    threatTop: <int>     // monotonic threat counter, never reused
  }
}
Diagram = { id:<int>, title, description, diagramType:"STRIDE"|"CIA"|"CIADIE"|"LINDDUN"|"PLOT4ai"|"EOP", version, thumbnail, cells:[ Cell ] }
```

Cell shapes are EXACTLY the objects returned by `td.vue/src/service/entity/default-properties.js` (`defaultEntity(type)` / `defaultData(type)`). tmcore must produce cells whose `data` matches those defaults, e.g.:
- node `tm.Process`: `{ id, shape:"process", position:{x,y}, size:{width:100,height:100}, zIndex:0, attrs:{text:{text:name},body:{...}}, data:{ type:"tm.Process", name, description, outOfScope:false, isTrustBoundary:false, hasOpenThreats:false, threats:[], ... } }`
- node `tm.Actor` (`shape:"actor"`, has `label`), `tm.Store` (`shape:"store"`).
- edge `tm.Flow` (`shape:"flow"`, `source:{cell,port}`, `target:{cell,port}`, `data.type:"tm.Flow"`).
- boundary `tm.BoundaryBox` (`shape:"trust-boundary-box"`, node) / `tm.Boundary` (`shape:"trust-boundary"`/curve edge), `data.isTrustBoundary:true`.

A model produced/edited by tmcore ops MUST pass `validateModel` against `threat-dragon-v2.schema.json`.

Threat object shape (from `td.vue/src/service/threats/index.js createNewTypedThreat`):
`{ id:<uuid>, title, status:"Open"|"Mitigated"|"NA", severity:"High"|"Medium"|"Low"|"TBD", type:<category>, description, mitigation, modelType, number:<int>, score:"" }`

## `ops` registry

Each op is a PURE function `(model, args) => { model, result }` — returns a NEW model (do not mutate input) and a small JSON-serializable `result`. Every MUTATING op runs `validateModel` on its output and throws `TmcoreError` (with `.errors`) if invalid.

| op | args | result |
|---|---|---|
| `createDiagram` | `{ title, diagramType }` | `{ diagramId }` |
| `addElement` | `{ diagramId, kind:"actor"\|"process"\|"store", name, position:{x,y}, description?, properties? }` | `{ cellId }` |
| `connectFlow` | `{ diagramId, sourceId, targetId, name?, protocol?, properties? }` | `{ cellId }` |
| `addBoundary` | `{ diagramId, kind:"box"\|"curve", name?, position?, size?, source?, target? }` | `{ cellId }` |
| `addThreat` | `{ diagramId, cellId, threat:{ title?, type?, severity?, status?, description?, mitigation?, modelType? } }` | `{ threatId, number }` |
| `updateElement` | `{ diagramId, cellId, patch:{ name?, description?, position?, size?, properties? } }` | `{ cellId }` |
| `removeElement` | `{ diagramId, cellId }` | `{ removed:[cellId, ...prunedFlowIds] }` |
| `listThreats` | `{ diagramId?, filters?:{ showOutOfScope?, showMitigated? } }` | `{ threats:[...] }` |
| `validateModel` | `{}` | `{ valid, errors }` |
| `getModelSummary` | `{}` | `{ diagrams:[{ id, title, diagramType, elementCount, threatCount }], totals:{ elements, threats, openThreats, bySeverity } }` |

Notes:
- `addThreat` increments `model.detail.threatTop` and sets the target cell's `data.hasOpenThreats`.
- `addElement` generates a uuid id, builds the cell from the default-properties template for the kind, sets `position`, `name` (and `attrs.text.text`/`label` per shape).
- `removeElement` also prunes flows whose `source.cell`/`target.cell` reference the removed id.
- `taxonomy` is the i18n-decoupled port of `threats/index.js`: default category per `(modelType, cellType)` using RAW English constants ("Spoofing", "Tampering", …), no `tc()` / no Vuex.

## `toolDefinitions`

Array of `{ name, description, input_schema }` where `name` matches the `ops` keys, `input_schema` is JSON Schema for the args above (only schema features AJV + Anthropic structured tools support: object/array/string/number/boolean/enum, `additionalProperties:false`, `required`). This array is the SINGLE SOURCE for: (a) LLM tool definitions sent by the browser agent loop, and (b) MCP tool registration. Descriptions must be prescriptive about WHEN to call each tool (helps the model).

## `validateModel(model) => { valid, errors }`

Compiles `shared/tmcore/schema/threat-dragon-v2.schema.json` with `new Ajv({allowUnionTypes:true})` + `addFormats` (same options as `td.vue/src/service/schema/ajv.js`). Interim: this schema file is a COPY of `td.vue/src/assets/schema/threat-dragon-v2.schema.json`; include a unit test asserting the two are byte/deep-identical so they can't drift (true single-source relocation is a later follow-up).
