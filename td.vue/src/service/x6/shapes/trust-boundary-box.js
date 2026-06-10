import { Shape } from '@antv/x6';

const name = 'trust-boundary-box';

// trust boundary box (dotted line, transparent background)
export const TrustBoundaryBox = Shape.Rect.define({
    constructorName: name,
    width: 500,
    height: 400,
    zIndex: -50,
    attrs: {
        body: {
            rx: 10,
            ry: 10,
            strokeWidth: 3,
            strokeDasharray: '10 5',
            fill: 'transparent',
            fillOpacity: 0
        },
        // label defaults to the top-left corner, inside the dashes
        label: {
            text: '',
            textAnchor: 'start',
            textVerticalAnchor: 'top',
            refX: 12,
            refY: 8
        }
    }
});

TrustBoundaryBox.prototype.type = 'tm.BoundaryBox';

TrustBoundaryBox.prototype.setName = function (name) {
    this.setAttrByPath('label/text', name);
};

TrustBoundaryBox.prototype.updateStyle = function () {};

export default {
    name,
    TrustBoundaryBox
};
