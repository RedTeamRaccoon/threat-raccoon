/**
 * @name xlsxExport
 * @description Exports all threats from a Threat Dragon v2 model as an Excel
 * workbook (.xlsx) for downstream tooling (e.g. Jira ticket generation).
 *
 * Column order: Threat Id | Asset Affected (Software Component or Function) |
 * Interaction | Title | Category | Description | Severity | Impact | Likelihood
 *
 * Flow cells (data.type === 'tm.Flow') populate Interaction; all other cell
 * types (Actor, Process, Store, …) populate Asset Affected.
 *
 * Threat Id: uses threat.number when present (human-friendly integer assigned
 * by the editor); falls back to threat.id (UUID) when number is absent or 0.
 *
 * exceljs is loaded lazily via dynamic import so it becomes a separate webpack
 * chunk and does not bloat the main bundle.
 */

const COLUMNS = [
    { header: 'Threat Id',                                        key: 'threatId',       width: 12 },
    { header: 'Asset Affected (Software Component or Function)',  key: 'assetAffected',  width: 40 },
    { header: 'Interaction',                                      key: 'interaction',    width: 30 },
    { header: 'Title',                                            key: 'title',          width: 30 },
    { header: 'Category',                                         key: 'category',       width: 20 },
    { header: 'Description',                                      key: 'description',    width: 50 },
    { header: 'Severity',                                         key: 'severity',       width: 12 },
    { header: 'Impact',                                           key: 'impact',         width: 15 },
    { header: 'Likelihood',                                       key: 'likelihood',     width: 15 },
];

/**
 * Returns true when the cell represents a data-flow edge.
 * Threat Dragon uses data.type === 'tm.Flow' for flows.
 * @param {Object} cell - a diagram cell object
 * @returns {boolean}
 */
const isFlowCell = (cell) => {
    return !!(cell.data && cell.data.type === 'tm.Flow');
};

/**
 * Pure function: maps a Threat Dragon v2 model object to an array of row
 * objects keyed by the COLUMNS key fields above.
 *
 * All threats across all diagrams are included (no out-of-scope filtering,
 * no mitigated filtering) so the PM's script receives the full picture.
 *
 * @param {Object} model - the full threat model (model.detail.diagrams[])
 * @returns {Array<Object>} flat array of row objects
 */
export const modelToRows = (model) => {
    const diagrams = (model && model.detail && model.detail.diagrams) || [];
    const rows = [];

    diagrams.forEach((diagram) => {
        const cells = diagram.cells || [];
        cells.forEach((cell) => {
            if (!cell.data || !Array.isArray(cell.data.threats)) {
                return;
            }

            const isFlow = isFlowCell(cell);
            const cellName = (cell.data.name || '').replace(/\n/g, ' ').trim();

            cell.data.threats.forEach((threat) => {
                // Prefer the human-readable integer number; fall back to UUID id
                const threatId = (threat.number != null && threat.number !== 0)
                    ? threat.number
                    : (threat.id || '');

                rows.push({
                    threatId,
                    assetAffected: isFlow ? '' : cellName,
                    interaction:   isFlow ? cellName : '',
                    title:         threat.title || '',
                    category:      threat.type || '',
                    description:   threat.description || '',
                    severity:      threat.severity || '',
                    impact:        threat.impact != null ? threat.impact : '',
                    likelihood:    threat.likelihood != null ? threat.likelihood : '',
                });
            });
        });
    });

    return rows;
};

/**
 * Sanitises a string for use as a file name: strips characters that are
 * illegal on common file systems and trims whitespace / dots.
 * @param {string} name
 * @returns {string}
 */
const sanitiseFileName = (name) => {
    return (name || 'threat-model')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/^[\s.-]+|[\s.-]+$/g, '')
        || 'threat-model';
};

/**
 * Builds an Excel workbook from the model and triggers a browser download.
 * exceljs is imported lazily to avoid enlarging the main bundle.
 *
 * @param {Object} model - the full threat model object
 * @returns {Promise<void>}
 */
export const exportXlsx = async (model) => {
    const ExcelJS = (await import(/* webpackChunkName: "exceljs" */ 'exceljs')).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Threat Dragon';
    workbook.created = new Date();

    const title = (model && model.summary && model.summary.title) || 'threat-model';
    const sheet = workbook.addWorksheet('Threats');

    // Define columns with headers and widths
    sheet.columns = COLUMNS;

    // Bold + freeze the header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();
    sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }];

    // Add data rows
    const rows = modelToRows(model);
    rows.forEach((row) => sheet.addRow(row));

    // Write to a buffer and trigger browser download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const fileName = `${sanitiseFileName(title)}-threats.xlsx`;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
};

export default { exportXlsx, modelToRows };
